const ts = require('../../frontendai/node_modules/typescript');
const fs = require('node:fs');const path=require('node:path');
const root=path.resolve('../frontendai');const config=ts.readConfigFile(path.join(root,'tsconfig.json'),ts.sys.readFile);const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root);const host=ts.createCompilerHost(parsed.options);const read=host.readFile;
const files=new Map([['src/app/pages/csr-pages/ReportsView.tsx','ReportsView.tsx'],['src/app/core/services/reports.ts','reports.ts']].map(([a,b])=>[path.join(root,a).toLowerCase(),path.resolve('.report-repair-staged',b)]));
host.readFile=file=>files.has(path.resolve(file).toLowerCase())?fs.readFileSync(files.get(path.resolve(file).toLowerCase()),'utf8'):read(file);
const diagnostics=ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames,parsed.options,host));console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>root,getCanonicalFileName:f=>f,getNewLine:()=> '\n'}));process.exitCode=diagnostics.length?1:0;
