
import fs from 'fs';
import path from 'path';
import glob from 'glob';

const rootDir = '/Users/wangzicai/Documents/tracking-guardian/app';

function findChineseChars(dir) {
  const files = glob.sync(`${dir}/**/*.{ts,tsx}`);
  const results = [];

  files.forEach(file => {
    if (file.includes('locales/')) return; // Skip translation files
    
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      // Simple regex to find Chinese characters
      if (/[\u4e00-\u9fa5]/.test(line)) {
        // Exclude comments
        if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) return;
        // Exclude console.log
        if (line.includes('console.log') || line.includes('console.error')) return;
        
        results.push({
          file: path.relative(rootDir, file),
          line: index + 1,
          content: line.trim()
        });
      }
    });
  });
  
  return results;
}

const findings = findChineseChars(rootDir);

if (findings.length > 0) {
  console.log('Found Chinese characters in source code (potential hardcoded strings):');
  findings.forEach(f => {
    console.log(`${f.file}:${f.line}: ${f.content}`);
  });
} else {
  console.log('No Chinese characters found in source code outside of locales.');
}
