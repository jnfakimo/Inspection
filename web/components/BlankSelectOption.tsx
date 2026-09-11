// 可留白的資料輸入下拉選單統一把真正的空值放在第一列；不要用提示文字取代空值。
export function BlankSelectOption() {
  return <option value="" aria-label="空白選項"></option>;
}
