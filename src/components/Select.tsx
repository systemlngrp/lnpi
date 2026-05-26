import React, { useMemo } from 'react';
import ReactSelect, { ActionMeta, SingleValue } from 'react-select';

import { Plus } from 'lucide-react';

interface OptionType {
  value: string;
  label: string;
}

interface SelectProps {
  options: OptionType[];
  value: string;
  onChange: (val: string) => void;
  onAdd?: () => void;
  placeholder?: string;
  id?: string;
  required?: boolean;
  disabled?: boolean;
}

export function Select({ options, value, onChange, onAdd, placeholder = "Select...", id, required, disabled }: SelectProps) {
  const selectedOption = options.find(opt => opt.value === value) || null;

  const handleChange = (newValue: SingleValue<OptionType>, actionMeta: ActionMeta<OptionType>) => {
    if (newValue) {
      onChange(newValue.value);
    } else {
      onChange("");
    }
  };

  return (
    <div className="flex items-start gap-2">
      <div className="flex-1 min-w-[200px]">
        <ReactSelect
          inputId={id}
          value={selectedOption}
          onChange={handleChange}
          options={options}
          getOptionLabel={(option: OptionType) => option.label}
          getOptionValue={(option: OptionType) => option.value}
          noOptionsMessage={() => "No items found"}
          isClearable
          isSearchable
          isDisabled={disabled}
          placeholder={placeholder}
          required={required}
          menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
          menuPosition="fixed"
          menuPlacement="auto"
          styles={{
            control: (base, state) => ({
              ...base,
              borderWidth: '2px',
              borderColor: state.isFocused ? '#4f46e5' : '#000000', // indigo-600 or black
              boxShadow: state.isFocused ? '0 0 0 1px #4f46e5' : 'none',
              '&:hover': {
                borderColor: state.isFocused ? '#4f46e5' : '#000000'
              },
              padding: '2px',
              borderRadius: '0.25rem',
              color: '#000000',
              backgroundColor: '#ffffff',
              minHeight: '42px'
            }),
            option: (base, state) => ({
              ...base,
              backgroundColor: state.isSelected ? '#4f46e5' : state.isFocused ? '#f0f0ff' : 'white',
              color: state.isSelected ? 'white' : 'black',
              fontSize: '14px',
              fontWeight: state.isSelected ? '700' : '500',
              padding: '10px 12px',
              cursor: 'pointer'
            }),
            menu: (base) => ({
              ...base,
              zIndex: 9999,
              border: '2px solid black',
              boxShadow: '4px 4px 0px 0px rgba(0,0,0,1)'
            }),
            menuPortal: (base) => ({
              ...base,
              zIndex: 9999
            }),
            singleValue: (base) => ({
              ...base,
              color: '#000000',
              fontWeight: '700',
              fontSize: '14px'
            }),
            placeholder: (base) => ({
              ...base,
              color: '#64748b', // slate-500
              fontSize: '14px',
              fontWeight: '600'
            }),
            input: (base) => ({
              ...base,
              color: '#000000'
            })
          }}
        />
      </div>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          title="Add New"
          className="mt-[2px] p-[10px] bg-indigo-600 text-white rounded hover:bg-indigo-700 transition shadow flex items-center justify-center border-2 border-indigo-700"
        >
          <Plus size={20} strokeWidth={3} />
        </button>
      )}
    </div>
  );
}
