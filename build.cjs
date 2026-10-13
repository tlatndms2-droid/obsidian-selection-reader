const fs=require('node:fs'),path=require('node:path');
const root=__dirname,version=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')).version;
let code=`// Selection Reader ${version}\nconst bundled={};\nconst localRequire=id=>Object.prototype.hasOwnProperty.call(bundled,id)?bundled[id].exports:require(id);\n`;
code+=`bundled['./worker-source']={exports:${JSON.stringify(('# '+fs.readFileSync(path.join(root,'SUPERTONIC-LICENSE'),'utf8').replace(/\n/g,'\n# '))+'\n'+fs.readFileSync(path.join(root,'supertonic-helper.py'),'utf8')+'\n'+fs.readFileSync(path.join(root,'supertonic-worker.py'),'utf8'))}};\n`;
for(const name of ['speech','selection','ai-catalog','model-store','ai-runtime','audio-cache','ai-speech'])code+=`bundled['./${name}']={exports:{}};\n(function(module,require){\n${fs.readFileSync(path.join(root,name+'.js'),'utf8')}\n})(bundled['./${name}'],localRequire);\n`;
code+=`(function(module,require){\n${fs.readFileSync(path.join(root,'plugin.js'),'utf8')}\n})(module,localRequire);\n`;
fs.writeFileSync(path.join(root,'main.js'),code);console.log('Built Selection Reader '+version);
