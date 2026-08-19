'use client';
import { useState } from 'react';

export function ComboboxSelect({ 
  value, 
  onChange, 
  options, 
  placeholder, 
  ariaLabel, 
  className = '' 
}: { 
  value: string; 
  onChange: (v: string) => void; 
  options: { value: string, label: string }[]; 
  placeholder?: string; 
  ariaLabel?: string; 
  className?: string; 
}) {
  const [id] = useState(() => 'combo-' + Math.random().toString(36).substring(2, 9));
  let displayValue = value;
  if (value) {
    const matchedOption = options.find(o => String(o.value) === String(value));
    if (matchedOption) displayValue = matchedOption.label;
  }
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    const rawMatch = options.find(o => o.label === inputValue);
    onChange(rawMatch ? rawMatch.value : inputValue);
  };

  return (
    <div className={`request-filter-combobox ${className}`}>
      <input 
        list={id} 
        value={displayValue} 
        onChange={handleChange} 
        placeholder={placeholder || '請選擇...'} 
        aria-label={ariaLabel} 
      />
      <span aria-hidden='true'>▾</span>
      <datalist id={id}>
        {options.map(o => <option key={o.value} value={o.label} />)}
      </datalist>
    </div>
  );
}
