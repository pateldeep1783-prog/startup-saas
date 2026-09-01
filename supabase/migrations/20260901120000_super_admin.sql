/*
  # Super Admin and Subscription Schema Updates
  
  1. Add `is_super_admin` to `profiles` table
  2. Add `subscription_plan` and `subscription_status` to `organizations` table
  3. Create `is_super_admin()` postgres helper function
  4. Update RLS policies on `organizations` to allow super admins full access
*/

-- 1. Add subscription info to organizations
ALTER TABLE organizations 
  ADD COLUMN IF NOT EXISTS subscription_plan text DEFAULT 'free' CHECK (subscription_plan IN ('free', 'starter', 'growth', 'pro')),
  ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'active' CHECK (subscription_status IN ('active', 'past_due', 'suspended', 'canceled'));

-- 2. Add is_super_admin to profiles
ALTER TABLE profiles 
  ADD COLUMN IF NOT EXISTS is_super_admin boolean DEFAULT false;

-- 3. Create helper function for RLS
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_super_admin FROM profiles WHERE id = auth.uid()), 
    false
  );
$$;

-- 4. Update organization policies to allow super admins
-- First drop existing policies so we can recreate them
DROP POLICY IF EXISTS "org_select_member" ON organizations;
DROP POLICY IF EXISTS "org_update_member" ON organizations;

-- Recreate policies with super admin access
CREATE POLICY "org_select_member" ON organizations FOR SELECT
  TO authenticated USING (is_org_member(id) OR is_super_admin());

CREATE POLICY "org_update_member" ON organizations FOR UPDATE
  TO authenticated USING (is_org_member(id) OR is_super_admin()) WITH CHECK (is_org_member(id) OR is_super_admin());

-- Also grant access to organization_members for super admins so they can see who owns what
DROP POLICY IF EXISTS "members_select_org" ON organization_members;
CREATE POLICY "members_select_org" ON organization_members FOR SELECT
  TO authenticated USING (is_org_member(organization_id) OR is_super_admin());
