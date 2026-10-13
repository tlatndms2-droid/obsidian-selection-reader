function normalizePdfText(text) {
  return text.replace(/\u00ad/g,'').replace(/[\s\u00a0]+/gu,' ').trim();
}
function frameRect(rect, frameBox, width, height) {
  const sx=frameBox.width/width,sy=frameBox.height/height;
  return {left:frameBox.left+rect.left*sx,right:frameBox.left+rect.right*sx,
    top:frameBox.top+rect.top*sy,bottom:frameBox.top+rect.bottom*sy,width:rect.width*sx,height:rect.height*sy};
}
module.exports={normalizePdfText,frameRect};
