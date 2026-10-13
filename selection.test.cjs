const test=require('node:test');const assert=require('node:assert/strict');
const {normalizePdfText,frameRect}=require('./selection');
test('PDF speech removes layout whitespace and soft hyphens without losing Korean or mixed text',()=>{
 assert.equal(normalizePdfText('  한국어\r\n PDF\u00a0  text\t읽기.\n\n다음 inter\u00adnational 문장  '),'한국어 PDF text 읽기. 다음 international 문장');
 assert.equal(normalizePdfText('A-B  123.45\nα + β'),'A-B 123.45 α + β');
});
test('Canvas iframe selection coordinates follow zoom and pan',()=>{
 assert.deepEqual(frameRect({left:10,right:110,top:20,bottom:40,width:100,height:20},{left:300,top:200,width:200,height:100},400,200),{left:305,right:355,top:210,bottom:220,width:50,height:10});
});
const {selectionFocusRect,selectionButtonPosition}=require('./selection');
test('selection endpoint follows forward/backward caret rather than multi-line union',()=>{
 const first={},last={};const doc={createRange:()=>({setStart(node,offset){this.node=node;this.offset=offset},collapse(){},getBoundingClientRect(){const left=this.node===first?100:150;return{left,right:left,top:220,bottom:240,width:0,height:20}}})};first.ownerDocument=last.ownerDocument=doc;
 const range={startContainer:first,startOffset:0,getBoundingClientRect:()=>({right:700}),getClientRects:()=>[]};
 const forward=selectionFocusRect({rangeCount:1,focusNode:last,focusOffset:5,getRangeAt:()=>range});assert.equal(forward.right,150);assert.equal(forward.backward,false);assert.deepEqual(selectionButtonPosition(forward,1000,800),{left:158,top:214});
 const backward=selectionFocusRect({rangeCount:1,focusNode:first,focusOffset:0,getRangeAt:()=>range});assert.equal(backward.backward,true);assert.equal(selectionButtonPosition(backward,1000,800).left,58);
});
test('button flips sides at viewport edges and stays within top/bottom limits',()=>{
 assert.deepEqual(selectionButtonPosition({left:990,right:990,top:795,height:20,backward:false},1000,800),{left:948,top:760});
 assert.deepEqual(selectionButtonPosition({left:3,right:3,top:0,height:20,backward:true},1000,800),{left:11,top:8});
});
