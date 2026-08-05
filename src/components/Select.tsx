import React from 'react';
import ReactSelect, { ActionMeta, SingleValue } from 'react-select';

import { Plus } from 'lucide-react';

interface OptionType {
  value: string;
  label: string;
  searchText?: string;
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
  compact?: boolean;
  wrapLabels?: boolean;
}

export function Select({ options, value, onChange, onAdd, placeholder = "Select...", id, required, disabled, compact = false, wrapLabels = false }: SelectProps) {
  const selectedOption = options.find(opt => opt.value === value) || null;

  const handleChange = (newValue: SingleValue<OptionType>, actionMeta: ActionMeta<OptionType>) => {
    if (newValue) {
      onChange(newValue.value);
    } else {
      onChange("");
    }
  };

  return (
    <div className={`grid w-full items-start gap-2 ${onAdd ? "grid-cols-[minmax(0,1fr)_42px]" : "grid-cols-1"}`}>
      <div className="min-w-0">
        <ReactSelect
          inputId={id}
          value={selectedOption}
          onChange={handleChange}
          options={options}
          filterOption={(candidate, inputValue) => {
            const query = inputValue.trim().toLowerCase();
            if (!query) return true;
            const option = candidate.data as OptionType;
            const haystack = `${option.searchText || option.label}`.toLowerCase();
            return haystack.includes(query);
          }}
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
              borderColor: state.isFocused ? '#4f46e5' : '#000000',
              boxShadow: state.isFocused ? '0 0 0 1px #4f46e5' : 'none',
              '&:hover': {
                borderColor: state.isFocused ? '#4f46e5' : '#000000'
              },
              padding: compact ? '0px' : '2px',
              borderRadius: '0.25rem',
              color: '#000000',
              backgroundColor: '#ffffff',
              minHeight: compact ? '34px' : '42px',
              height: wrapLabels ? 'auto' : base.height
            }),
            valueContainer: (base) => ({
              ...base,
              alignItems: wrapLabels ? 'flex-start' : base.alignItems,
              flexWrap: wrapLabels ? 'wrap' : base.flexWrap,
              paddingTop: wrapLabels ? '3px' : base.paddingTop,
              paddingBottom: wrapLabels ? '3px' : base.paddingBottom
            }),
            option: (base, state) => ({
              ...base,
              backgroundColor: state.isSelected ? '#4f46e5' : state.isFocused ? '#f0f0ff' : 'white',
              color: state.isSelected ? 'white' : 'black',
              fontSize: compact ? '12px' : '14px',
              fontWeight: state.isSelected ? '700' : '500',
              padding: compact ? '7px 9px' : '10px 12px',
              cursor: 'pointer',
              whiteSpace: wrapLabels ? 'normal' : base.whiteSpace,
              overflowWrap: wrapLabels ? 'anywhere' : base.overflowWrap
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
              fontSize: compact ? '12px' : '14px',
              whiteSpace: wrapLabels ? 'normal' : base.whiteSpace,
              overflow: wrapLabels ? 'visible' : base.overflow,
              textOverflow: wrapLabels ? 'clip' : base.textOverflow,
              overflowWrap: wrapLabels ? 'anywhere' : base.overflowWrap,
              lineHeight: wrapLabels ? '1.15' : base.lineHeight
            }),
            placeholder: (base) => ({
              ...base,
              color: '#64748b',
              fontSize: compact ? '12px' : '14px',
              fontWeight: '600'
            }),
            input: (base) => ({
              ...base,
              color: '#000000'
            })
          }}
        />
      </div>
      {onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          title="Add New"
          className="mt-[2px] flex h-[42px] w-[42px] items-center justify-center rounded border-2 border-indigo-700 bg-indigo-600 text-white shadow transition hover:bg-indigo-700"
        >
          <Plus size={18} strokeWidth={3} />
        </button>
      ) : null}
    </div>
  );
}
