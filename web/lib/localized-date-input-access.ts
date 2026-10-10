export type LocalizedDateInputAccessOptions = {
  manual: boolean;
  readOnly?: boolean;
  disabled?: boolean;
};

export function getLocalizedDateInputAccess({ manual, readOnly = false, disabled = false }: LocalizedDateInputAccessOptions) {
  return {
    inputReadOnly: readOnly || (!manual && !disabled),
    ariaReadOnly: !disabled && (readOnly || !manual),
    pickerDisabled: disabled || readOnly,
    manualEditable: manual && !disabled && !readOnly,
    nativeChangeEnabled: !disabled && !readOnly,
  };
}
