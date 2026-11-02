const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const ExcelJS = require('exceljs');
const excelRequire = require('node:module').createRequire(require.resolve('exceljs'));
const archiver = excelRequire('archiver');
const unzipper = excelRequire('unzipper');
(async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'inspection-excel-'));
 try {
  const wb=new ExcelJS.Workbook(); const ws=wb.addWorksheet('巡檢');
  ws.addRow(['設備','數量','日期','合計']);
  ws.addRow(['泵浦',3,new Date('2026-11-02T00:00:00Z'),{formula:'B2*2',result:6}]);
  ws.getCell('A1').font={bold:true}; ws.getCell('C2').numFmt='yyyy-mm-dd';
  const buffer=await wb.xlsx.writeBuffer();
  const copy=new ExcelJS.Workbook();await copy.xlsx.load(buffer);
  assert.equal(copy.worksheets[0].getCell('A2').value,'泵浦');
  assert.equal(copy.worksheets[0].getCell('B2').value,3);
  assert.equal(copy.worksheets[0].getCell('D2').value.result,6);
  assert.equal(copy.worksheets[0].getCell('A1').font.bold,true);
  const file=path.join(tmp,'stream.xlsx');
  const stream=new ExcelJS.stream.xlsx.WorkbookWriter({filename:file,useStyles:true,useSharedStrings:true});
  const sheet=stream.addWorksheet('巡檢');sheet.addRow(['測試',42]).commit();await stream.commit();
  let rowCount=0; const reader=new ExcelJS.stream.xlsx.WorkbookReader(file);
  for await(const worksheet of reader) for await(const row of worksheet){assert.equal(row.values[2],42);rowCount++;}
  assert.equal(rowCount,1);
  await fs.writeFile(path.join(tmp,'sample.txt'),'inspection');
  const utils=require('node:module').createRequire(excelRequire.resolve('archiver'))('archiver-utils');
  assert.deepEqual(utils.file.expand({cwd:tmp},['*.txt','!missing.txt']),['sample.txt']);
  const archive=archiver('zip');const chunks=[];
  archive.on('data',chunk=>chunks.push(chunk));
  const ended=new Promise((resolve,reject)=>{archive.on('end',resolve);archive.on('error',reject)});
  archive.glob('*.txt',{cwd:tmp});await archive.finalize();await ended;
  const zip=await unzipper.Open.buffer(Buffer.concat(chunks));
  assert.equal(zip.files.length,1);assert.equal((await zip.files[0].buffer()).toString(),'inspection');
  console.log('PASS: Excel XLSX buffer roundtrip, styles, formulas, streaming writer/reader, archive glob + unzip');
 } finally {await fs.rm(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
