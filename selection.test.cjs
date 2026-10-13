const test=require('node:test');const assert=require('node:assert/strict');
const {normalizePdfText,frameRect}=require('./selection');
test('PDF speech removes layout whitespace and soft hyphens without losing Korean or mixed text',()=>{
 assert.equal(normalizePdfText('  한국어\r\n PDF\u00a0  text\t읽기.\n\n다음 inter\u00adnational 문장  '),'한국어 PDF text 읽기. 다음 international 문장');
 assert.equal(normalizePdfText('A-B  123.45\nα + β'),'A-B 123.45 α + β');
});
test('Canvas iframe selection coordinates follow zoom and pan',()=>{
 assert.deepEqual(frameRect({left:10,right:110,top:20,bottom:40,width:100,height:20},{left:300,top:200,width:200,height:100},400,200),{left:305,right:355,top:210,bottom:220,width:50,height:10});
});
