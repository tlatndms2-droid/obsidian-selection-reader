function normalizePdfText(text) {
  return text.replace(/\u00ad/g,'').replace(/[\s\u00a0]+/gu,' ').trim();
}
function frameRect(rect, frameBox, width, height) {
  const sx=frameBox.width/width,sy=frameBox.height/height;
  return {left:frameBox.left+rect.left*sx,right:frameBox.left+rect.right*sx,
    top:frameBox.top+rect.top*sy,bottom:frameBox.top+rect.bottom*sy,width:rect.width*sx,height:rect.height*sy};
}
function selectionFocusRect(selection){
 if(!selection?.rangeCount||!selection.focusNode)return null;
 const selected=selection.getRangeAt(0),backward=selection.focusNode===selected.startContainer&&selection.focusOffset===selected.startOffset;
 const copy=r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,backward});
 try{const caret=selection.focusNode.ownerDocument.createRange();caret.setStart(selection.focusNode,selection.focusOffset);caret.collapse(true);const rect=caret.getBoundingClientRect();if(rect.height)return copy(rect);}catch{}
 const rects=Array.from(selected.getClientRects()).filter(r=>r.height);const rect=backward?rects[0]:rects.at(-1);if(!rect)return null;
 const edge=backward?rect.left:rect.right;return copy({...rect,left:edge,right:edge,top:rect.top,bottom:rect.bottom,width:0,height:rect.height});
}
function selectionButtonPosition(rect,width,height,buttonWidth=34,buttonHeight=32){
 const gap=8,padding=8,right=rect.right+gap,left=rect.left-gap-buttonWidth;
 let x=rect.backward?left:right;if(x<padding||x+buttonWidth>width-padding)x=rect.backward?right:left;
 return {left:Math.max(padding,Math.min(x,width-padding-buttonWidth)),top:Math.max(padding,Math.min(rect.top+(rect.height-buttonHeight)/2,height-padding-buttonHeight))};
}
module.exports={normalizePdfText,frameRect,selectionFocusRect,selectionButtonPosition};
