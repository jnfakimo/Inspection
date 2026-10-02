import assert from 'node:assert/strict';
import test from 'node:test';
import { maskGuardPersonalData, maskGuardReportFields } from './guard-personal-data.ts';

test('駐警交班文字遮蔽身分證末五碼與常見中文姓名', () => {
  assert.equal(maskGuardPersonalData('王小明車禍，張大華於現場；身分證 A123456789'),
    '王O明車禍，張O華於現場；身分證 A1234*****');
  assert.equal(maskGuardPersonalData('當事人：李四，身分證B223456789；歐陽娜娜協助處理'),
    '當事人：李O，身分證B2234*****；歐OO娜協助處理');
  assert.equal(maskGuardPersonalData('民眾王小明於林口市場報案'), '民眾王O明於林口市場報案');
  assert.equal(maskGuardPersonalData('本班值勤正常，陳先生報案'), '本班值勤正常，陳先生報案');
  assert.equal(maskGuardPersonalData('XA1234567890'), 'XA1234567890');
  assert.equal(maskGuardPersonalData('電話 0912-345-678'), '電話 091*-***-*78');
});

test('交班欄位遮蔽不改動原始物件或結構', () => {
  const original = {
    duty_summary: '王小明車禍', important_notes: 'A123456789', status: 'received',
    incidents: [{ id: '123', description: '張大華於現場', action: '已通報', location: '一市場' }],
    items: [{ name: '無線電', qty: 1, condition: '正常', note: '交予王小明' }],
  };
  const masked = maskGuardReportFields(original);
  assert.equal(masked.duty_summary, '王O明車禍');
  assert.equal(masked.important_notes, 'A1234*****');
  assert.equal(masked.incidents[0].description, '張O華於現場');
  assert.equal(masked.items[0].note, '交予王O明');
  assert.equal(masked.items[0].qty, 1);
  assert.equal(original.duty_summary, '王小明車禍');
});

test('結構化相關人員在一般交接檢視時遮蔽，原始資料不變', () => {
  const original = { duty_summary: '王小明電話 0912345678', incidents: [{
    id: 'one', description: '王小明駕車', action: '聯絡 0912345678',
    persons: [{ name: '王小明', id_number: 'A123456789', phone: '0912345678' }],
  }] };
  const masked = maskGuardReportFields(original);
  assert.equal(masked.incidents[0].persons[0].name, '王O明');
  assert.equal(masked.incidents[0].persons[0].id_number, 'A1234*****');
  assert.equal(masked.incidents[0].persons[0].phone, '091*****78');
  assert.equal(masked.duty_summary, '王O明電話 091*****78');
  assert.equal(masked.incidents[0].description, '王O明駕車');
  assert.equal(masked.incidents[0].action, '聯絡 091*****78');
  assert.equal(original.incidents[0].persons[0].id_number, 'A123456789');
});
