/*
# ReceptionAI Core Schema — Multi-tenant foundation

1. Purpose
- Establishes the multi-tenant foundation for ReceptionAI: organizations, members,
  locations, services, staff, working hours, customers, and bookings.
- Every organization-owned table carries organization_id for tenant isolation.
- RLS is enabled on every table; access is gated through an org-membership helper.

2. New Tables
- `profiles` — extends auth.users with full_name, avatar_url, country.
- `organizations` — the tenant root: name, slug, country, currency, timezone, industry, settings (jsonb).
- `organization_members` — joins users to orgs with a role (owner/admin/manager/staff/read_only).
- `locations` — physical/business locations per org with address, timezone, phone.
- `services` — bookable services: name, duration, price, buffers, deposit, cancellation policy, active.
- `staff` — staff members per org: name, email, phone, role, job_title, working hours.
- `service_staff` — many-to-many linking services to the staff who can perform them.
- `staff_hours` — per-staff weekly working hours (day 0-6, start/end).
- `staff_breaks` — per-staff daily break windows.
- `staff_leave` — per-staff time-off ranges.
- `business_hours` — per-location weekly opening hours.
- `customers` — customer CRM records per org: name, email, phone, status, tags, notes.
- `customer_notes` — internal notes on customers.
- `bookings` — appointment records linking customer, service, staff, location, time, status, payment.
- `booking_status_history` — append-only status transitions for auditability.

3. Security
- RLS enabled on all tables.
- `is_org_member(org_id)` SECURITY DEFINER helper checks membership via organization_members.
- All org-owned tables scope SELECT/INSERT/UPDATE/DELETE to org members.
- profiles table: users can read/update only their own profile row.
- Public booking access via SECURITY DEFINER functions reading org by slug (anon callable).

4. Notes
- UUIDs throughout; gen_random_uuid() defaults.
- Indexes on organization_id, status, date columns, foreign keys.
- Soft-delete via deleted_at on customers and staff.
- booking status constrained to an enum-like check.
- Ordering: tables created before the is_org_member function that references them.
*/

-- ============================================================
-- updated_at trigger function (defined early for reuse)
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  avatar_url text,
  country text DEFAULT 'GB',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT
  TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DO $$ BEGIN
  CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- ORGANIZATIONS (tenant root)
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  industry text DEFAULT 'other',
  country text DEFAULT 'GB',
  currency text DEFAULT 'GBP',
  timezone text DEFAULT 'Europe/London',
  settings jsonb DEFAULT '{}'::jsonb,
  onboarding_completed boolean DEFAULT false,
  onboarding_step int DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE TRIGGER orgs_updated_at BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- ORGANIZATION MEMBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','admin','manager','staff','read_only')),
  invited_email text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Org membership helper (SECURITY DEFINER) — defined after organization_members exists
-- ============================================================
CREATE OR REPLACE FUNCTION is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = p_org_id AND user_id = auth.uid()
  );
$$;

-- Now apply org policies (after helper exists)
DROP POLICY IF EXISTS "org_select_member" ON organizations;
CREATE POLICY "org_select_member" ON organizations FOR SELECT
  TO authenticated USING (is_org_member(id));

DROP POLICY IF EXISTS "org_update_member" ON organizations;
CREATE POLICY "org_update_member" ON organizations FOR UPDATE
  TO authenticated USING (is_org_member(id)) WITH CHECK (is_org_member(id));

DROP POLICY IF EXISTS "org_insert_member" ON organizations;
CREATE POLICY "org_insert_member" ON organizations FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "members_select_org" ON organization_members;
CREATE POLICY "members_select_org" ON organization_members FOR SELECT
  TO authenticated USING (is_org_member(organization_id));

DROP POLICY IF EXISTS "members_insert_org" ON organization_members;
CREATE POLICY "members_insert_org" ON organization_members FOR INSERT
  TO authenticated WITH CHECK (is_org_member(organization_id));

DROP POLICY IF EXISTS "members_update_org" ON organization_members;
CREATE POLICY "members_update_org" ON organization_members FOR UPDATE
  TO authenticated USING (is_org_member(organization_id)) WITH CHECK (is_org_member(organization_id));

DROP POLICY IF EXISTS "members_delete_org" ON organization_members;
CREATE POLICY "members_delete_org" ON organization_members FOR DELETE
  TO authenticated USING (is_org_member(organization_id));

-- ============================================================
-- LOCATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  city text,
  postcode text,
  phone text,
  timezone text DEFAULT 'Europe/London',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_locations_org ON locations(organization_id);

DO $$ BEGIN
  CREATE TRIGGER locations_updated_at BEFORE UPDATE ON locations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "loc_select_org" ON locations;
CREATE POLICY "loc_select_org" ON locations FOR SELECT
  TO authenticated USING (is_org_member(organization_id));
DROP POLICY IF EXISTS "loc_insert_org" ON locations;
CREATE POLICY "loc_insert_org" ON locations FOR INSERT
  TO authenticated WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "loc_update_org" ON locations;
CREATE POLICY "loc_update_org" ON locations FOR UPDATE
  TO authenticated USING (is_org_member(organization_id)) WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "loc_delete_org" ON locations;
CREATE POLICY "loc_delete_org" ON locations FOR DELETE
  TO authenticated USING (is_org_member(organization_id));

-- ============================================================
-- SERVICES
-- ============================================================
CREATE TABLE IF NOT EXISTS services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  duration_minutes int NOT NULL DEFAULT 30,
  price numeric(10,2) DEFAULT 0,
  currency text DEFAULT 'GBP',
  buffer_before int DEFAULT 0,
  buffer_after int DEFAULT 0,
  location_type text DEFAULT 'in_person' CHECK (location_type IN ('in_person','online')),
  deposit_required boolean DEFAULT false,
  deposit_amount numeric(10,2) DEFAULT 0,
  deposit_type text DEFAULT 'fixed' CHECK (deposit_type IN ('fixed','percentage','full')),
  cancellation_policy text,
  cancellation_window_hours int DEFAULT 24,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_services_org ON services(organization_id);

DO $$ BEGIN
  CREATE TRIGGER services_updated_at BEFORE UPDATE ON services
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "svc_select_org" ON services;
CREATE POLICY "svc_select_org" ON services FOR SELECT
  TO authenticated USING (is_org_member(organization_id));
DROP POLICY IF EXISTS "svc_insert_org" ON services;
CREATE POLICY "svc_insert_org" ON services FOR INSERT
  TO authenticated WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "svc_update_org" ON services;
CREATE POLICY "svc_update_org" ON services FOR UPDATE
  TO authenticated USING (is_org_member(organization_id)) WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "svc_delete_org" ON services;
CREATE POLICY "svc_delete_org" ON services FOR DELETE
  TO authenticated USING (is_org_member(organization_id));

-- ============================================================
-- STAFF
-- ============================================================
CREATE TABLE IF NOT EXISTS staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone text,
  role text DEFAULT 'staff' CHECK (role IN ('owner','admin','manager','staff','read_only')),
  job_title text,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  is_active boolean DEFAULT true,
  color text DEFAULT '#3b82f6',
  deleted_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_staff_org ON staff(organization_id);

DO $$ BEGIN
  CREATE TRIGGER staff_updated_at BEFORE UPDATE ON staff
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "staff_select_org" ON staff;
CREATE POLICY "staff_select_org" ON staff FOR SELECT
  TO authenticated USING (is_org_member(organization_id));
DROP POLICY IF EXISTS "staff_insert_org" ON staff;
CREATE POLICY "staff_insert_org" ON staff FOR INSERT
  TO authenticated WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "staff_update_org" ON staff;
CREATE POLICY "staff_update_org" ON staff FOR UPDATE
  TO authenticated USING (is_org_member(organization_id)) WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "staff_delete_org" ON staff;
CREATE POLICY "staff_delete_org" ON staff FOR DELETE
  TO authenticated USING (is_org_member(organization_id));

-- ============================================================
-- SERVICE_STAFF (many-to-many)
-- ============================================================
CREATE TABLE IF NOT EXISTS service_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  UNIQUE (service_id, staff_id)
);
ALTER TABLE service_staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ss_select_org" ON service_staff;
CREATE POLICY "ss_select_org" ON service_staff FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM services s WHERE s.id = service_id AND is_org_member(s.organization_id))
  );
DROP POLICY IF EXISTS "ss_insert_org" ON service_staff;
CREATE POLICY "ss_insert_org" ON service_staff FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM services s WHERE s.id = service_id AND is_org_member(s.organization_id))
  );
DROP POLICY IF EXISTS "ss_delete_org" ON service_staff;
CREATE POLICY "ss_delete_org" ON service_staff FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM services s WHERE s.id = service_id AND is_org_member(s.organization_id))
  );

-- ============================================================
-- STAFF HOURS / BREAKS / LEAVE
-- ============================================================
CREATE TABLE IF NOT EXISTS staff_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  day_of_week int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL DEFAULT '09:00',
  end_time time NOT NULL DEFAULT '17:00',
  is_working boolean DEFAULT true,
  UNIQUE (staff_id, day_of_week)
);
ALTER TABLE staff_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sh_select_org" ON staff_hours;
CREATE POLICY "sh_select_org" ON staff_hours FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM staff st WHERE st.id = staff_id AND is_org_member(st.organization_id))
  );
DROP POLICY IF EXISTS "sh_insert_org" ON staff_hours;
CREATE POLICY "sh_insert_org" ON staff_hours FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM staff st WHERE st.id = staff_id AND is_org_member(st.organization_id))
  );
DROP POLICY IF EXISTS "sh_update_org" ON staff_hours;
CREATE POLICY "sh_update_org" ON staff_hours FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM staff st WHERE st.id = staff_id AND is_org_member(st.organization_id))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM staff st WHERE st.id = staff_id AND is_org_member(st.organization_id))
  );
DROP POLICY IF EXISTS "sh_delete_org" ON staff_hours;
CREATE POLICY "sh_delete_org" ON staff_hours FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM staff st WHERE st.id = staff_id AND is_org_member(st.organization_id))
  );

CREATE TABLE IF NOT EXISTS staff_breaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  day_of_week int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL
);
ALTER TABLE staff_breaks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sb_select_org" ON staff_breaks;
CREATE POLICY "sb_select_org" ON staff_breaks FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM staff st WHERE st.id = staff_id AND is_org_member(st.organization_id))
  );
DROP POLICY IF EXISTS "sb_insert_org" ON staff_breaks;
CREATE POLICY "sb_insert_org" ON staff_breaks FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM staff st WHERE st.id = staff_id AND is_org_member(st.organization_id))
  );
DROP POLICY IF EXISTS "sb_delete_org" ON staff_breaks;
CREATE POLICY "sb_delete_org" ON staff_breaks FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM staff st WHERE st.id = staff_id AND is_org_member(st.organization_id))
  );

CREATE TABLE IF NOT EXISTS staff_leave (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE staff_leave ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sl_select_org" ON staff_leave;
CREATE POLICY "sl_select_org" ON staff_leave FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM staff st WHERE st.id = staff_id AND is_org_member(st.organization_id))
  );
DROP POLICY IF EXISTS "sl_insert_org" ON staff_leave;
CREATE POLICY "sl_insert_org" ON staff_leave FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM staff st WHERE st.id = staff_id AND is_org_member(st.organization_id))
  );
DROP POLICY IF EXISTS "sl_delete_org" ON staff_leave;
CREATE POLICY "sl_delete_org" ON staff_leave FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM staff st WHERE st.id = staff_id AND is_org_member(st.organization_id))
  );

-- ============================================================
-- BUSINESS HOURS (per location)
-- ============================================================
CREATE TABLE IF NOT EXISTS business_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  day_of_week int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL DEFAULT '09:00',
  end_time time NOT NULL DEFAULT '17:00',
  is_open boolean DEFAULT true,
  UNIQUE (location_id, day_of_week)
);
ALTER TABLE business_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bh_select_org" ON business_hours;
CREATE POLICY "bh_select_org" ON business_hours FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM locations l WHERE l.id = location_id AND is_org_member(l.organization_id))
  );
DROP POLICY IF EXISTS "bh_insert_org" ON business_hours;
CREATE POLICY "bh_insert_org" ON business_hours FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM locations l WHERE l.id = location_id AND is_org_member(l.organization_id))
  );
DROP POLICY IF EXISTS "bh_update_org" ON business_hours;
CREATE POLICY "bh_update_org" ON business_hours FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM locations l WHERE l.id = location_id AND is_org_member(l.organization_id))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM locations l WHERE l.id = location_id AND is_org_member(l.organization_id))
  );
DROP POLICY IF EXISTS "bh_delete_org" ON business_hours;
CREATE POLICY "bh_delete_org" ON business_hours FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM locations l WHERE l.id = location_id AND is_org_member(l.organization_id))
  );

-- ============================================================
-- CUSTOMERS
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone text,
  status text DEFAULT 'new' CHECK (status IN ('lead','new','active','returning','inactive')),
  tags text[] DEFAULT '{}',
  notes text,
  marketing_consent boolean DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_customers_org ON customers(organization_id);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(organization_id, email);

DO $$ BEGIN
  CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "cust_select_org" ON customers;
CREATE POLICY "cust_select_org" ON customers FOR SELECT
  TO authenticated USING (is_org_member(organization_id));
DROP POLICY IF EXISTS "cust_insert_org" ON customers;
CREATE POLICY "cust_insert_org" ON customers FOR INSERT
  TO authenticated WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "cust_update_org" ON customers;
CREATE POLICY "cust_update_org" ON customers FOR UPDATE
  TO authenticated USING (is_org_member(organization_id)) WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "cust_delete_org" ON customers;
CREATE POLICY "cust_delete_org" ON customers FOR DELETE
  TO authenticated USING (is_org_member(organization_id));

CREATE TABLE IF NOT EXISTS customer_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE customer_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cn_select_org" ON customer_notes;
CREATE POLICY "cn_select_org" ON customer_notes FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND is_org_member(c.organization_id))
  );
DROP POLICY IF EXISTS "cn_insert_org" ON customer_notes;
CREATE POLICY "cn_insert_org" ON customer_notes FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND is_org_member(c.organization_id))
  );
DROP POLICY IF EXISTS "cn_delete_org" ON customer_notes;
CREATE POLICY "cn_delete_org" ON customer_notes FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND is_org_member(c.organization_id))
  );

-- ============================================================
-- BOOKINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rescheduled','cancelled','checked_in','completed','no_show')),
  source text DEFAULT 'manual' CHECK (source IN ('manual','ai_chat','ai_voice','online','phone')),
  notes text,
  price numeric(10,2) DEFAULT 0,
  payment_status text DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed','refunded','partially_refunded')),
  deposit_amount numeric(10,2) DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_bookings_org ON bookings(organization_id);
CREATE INDEX IF NOT EXISTS idx_bookings_start ON bookings(start_time);
CREATE INDEX IF NOT EXISTS idx_bookings_staff ON bookings(staff_id);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

DO $$ BEGIN
  CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON bookings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "bk_select_org" ON bookings;
CREATE POLICY "bk_select_org" ON bookings FOR SELECT
  TO authenticated USING (is_org_member(organization_id));
DROP POLICY IF EXISTS "bk_insert_org" ON bookings;
CREATE POLICY "bk_insert_org" ON bookings FOR INSERT
  TO authenticated WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "bk_update_org" ON bookings;
CREATE POLICY "bk_update_org" ON bookings FOR UPDATE
  TO authenticated USING (is_org_member(organization_id)) WITH CHECK (is_org_member(organization_id));
DROP POLICY IF EXISTS "bk_delete_org" ON bookings;
CREATE POLICY "bk_delete_org" ON bookings FOR DELETE
  TO authenticated USING (is_org_member(organization_id));

CREATE TABLE IF NOT EXISTS booking_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  status text NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE booking_status_history ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_bsh_booking ON booking_status_history(booking_id);

DROP POLICY IF EXISTS "bsh_select_org" ON booking_status_history;
CREATE POLICY "bsh_select_org" ON booking_status_history FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id AND is_org_member(b.organization_id))
  );
DROP POLICY IF EXISTS "bsh_insert_org" ON booking_status_history;
CREATE POLICY "bsh_insert_org" ON booking_status_history FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id AND is_org_member(b.organization_id))
  );

-- ============================================================
-- PUBLIC BOOKING ACCESS (anon can read org by slug, services, staff)
-- ============================================================
CREATE OR REPLACE FUNCTION get_public_org(p_slug text)
RETURNS TABLE (
  id uuid, name text, slug text, country text, currency text, timezone text, industry text, settings jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, slug, country, currency, timezone, industry, settings
  FROM organizations
  WHERE slug = p_slug;
$$;

CREATE OR REPLACE FUNCTION get_public_services(p_org_slug text)
RETURNS TABLE (
  id uuid, name text, description text, duration_minutes int, price numeric, currency text,
  location_type text, deposit_required boolean, deposit_amount numeric, deposit_type text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.name, s.description, s.duration_minutes, s.price, s.currency,
         s.location_type, s.deposit_required, s.deposit_amount, s.deposit_type
  FROM services s
  JOIN organizations o ON o.id = s.organization_id
  WHERE o.slug = p_org_slug AND s.is_active = true;
$$;

CREATE OR REPLACE FUNCTION get_public_staff(p_org_slug text)
RETURNS TABLE (
  id uuid, name text, job_title text, color text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT st.id, st.name, st.job_title, st.color
  FROM staff st
  JOIN organizations o ON o.id = st.organization_id
  WHERE o.slug = p_org_slug AND st.is_active = true AND st.deleted_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION get_public_org(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_public_services(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_public_staff(text) TO anon, authenticated;
