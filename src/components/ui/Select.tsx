import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

interface Option {
  value: string;
  label: string;
}

interface CustomSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}

export function CustomSelect({ options, value, onChange, placeholder = "Select...", required }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative w-full" ref={containerRef}>
      {/* Hidden input for HTML form validation if required */}
      {required && (
        <input 
          type="text" 
          required={required} 
          value={value} 
          className="absolute opacity-0 pointer-events-none h-0 w-0 -z-10" 
          onChange={() => {}} 
          tabIndex={-1}
        />
      )}
      
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-left text-gray-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 flex items-center justify-between"
      >
        <span className="truncate pr-4">
          {selectedOption ? selectedOption.label : <span className="text-gray-400">{placeholder}</span>}
        </span>
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute z-[100] mt-1 w-full rounded-lg border border-gray-200 bg-white py-1 shadow-lg max-h-60 overflow-y-auto">
          {options.length === 0 ? (
            <div className="px-3.5 py-2 text-sm text-gray-500">No options available</div>
          ) : (
            options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`w-full text-left px-3.5 py-2 text-sm hover:bg-gray-50 flex items-center justify-between ${
                  value === opt.value ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700'
                }`}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
              >
                <span className="truncate">{opt.label}</span>
                {value === opt.value && <Check className="h-4 w-4" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
