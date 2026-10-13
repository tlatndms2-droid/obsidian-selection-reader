const fs=require('node:fs'),path=require('node:path');
function modelBytes(directory){
 if(!fs.existsSync(directory))return 0;
 const stat=fs.lstatSync(directory);if(stat.isSymbolicLink())throw Error('연결된 폴더는 모델 관리 대상에서 제외됩니다.');
 if(!stat.isDirectory())return stat.size;
 return fs.readdirSync(directory).reduce((n,file)=>n+modelBytes(path.join(directory,file)),0);
}
function checkedModelDirectory(root,directory){
 const expected=path.resolve(root,'models','supertonic-3');
 if(path.resolve(directory)!==expected)throw Error('모델 삭제 경로가 올바르지 않습니다.');
 const realRoot=fs.realpathSync.native(root);
 for(const relative of ['models',path.join('models','supertonic-3')]){
  const candidate=path.join(root,relative);if(!fs.existsSync(candidate))continue;
  if(fs.lstatSync(candidate).isSymbolicLink()||fs.realpathSync.native(candidate)!==path.join(realRoot,relative))throw Error('모델 경로가 저장 폴더 밖으로 연결되어 있어 삭제하지 않았습니다.');
 }
 modelBytes(directory); // Reject nested junctions before recursive removal too.
 return expected;
}
async function removeModelFiles(root,directory){
 const target=checkedModelDirectory(root,directory);
 // Invalidate readiness first. A failed removal remains recoverable by reinstall.
 await fs.promises.rm(path.join(root,'ready.json'),{force:true});
 await fs.promises.rm(target,{recursive:true,force:true});
}
module.exports={modelBytes,checkedModelDirectory,removeModelFiles};
