#!/usr/bin/env node

import { readFileSync, writeFileSync, statSync } from 'fs';
import { readdirSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function removeComments(content) {
  let result = '';
  let i = 0;
  let inString = false;
  let stringChar = null;
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  
  while (i < content.length) {
    const char = content[i];
    const nextChar = content[i + 1] || '';
    const prevChar = content[i - 1] || '';
    
    if (!inSingleLineComment && !inMultiLineComment) {
      if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
        if (!inString) {
          inString = true;
          stringChar = char;
          result += char;
          i++;
          continue;
        } else if (char === stringChar) {
          inString = false;
          stringChar = null;
          result += char;
          i++;
          continue;
        }
      }
    }
    
    if (inString) {
      result += char;
      i++;
      continue;
    }
    
    if (char === '/' && nextChar === '/' && !inMultiLineComment) {
      inSingleLineComment = true;
      i += 2;
      while (i < content.length && content[i] !== '\n') {
        i++;
      }
      if (i < content.length && content[i] === '\n') {
        result += '\n';
        i++;
      }
      inSingleLineComment = false;
      continue;
    }
    
    if (char === '/' && nextChar === '*' && !inSingleLineComment) {
      inMultiLineComment = true;
      i += 2;
      while (i < content.length) {
        if (content[i] === '*' && content[i + 1] === '/') {
          i += 2;
          inMultiLineComment = false;
          break;
        }
        i++;
      }
      continue;
    }
    
    if (!inSingleLineComment && !inMultiLineComment) {
      result += char;
    }
    
    i++;
  }
  
  return result.split('\n').map(line => line.trimEnd()).join('\n');
}

function getAllFiles(dir, fileList = []) {
  const files = readdirSync(dir);
  
  files.forEach(file => {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    
    if (stat.isDirectory()) {
      if (file === 'node_modules' || file === '.git' || file === 'build' || file === 'dist' || file === '.next') {
        return;
      }
      getAllFiles(filePath, fileList);
    } else {
      if (/\.(ts|tsx|js|jsx)$/.test(file)) {
        if (!/\.config\.(ts|js)$/.test(file) && file !== 'vite.config.ts' && file !== 'vitest.config.ts' && file !== 'remove-comments.mjs' && file !== 'test-remove-comments.mjs') {
          fileList.push(filePath);
        }
      }
    }
  });
  
  return fileList;
}

const files = getAllFiles(__dirname);

console.log(`Found ${files.length} files to process...`);

let processed = 0;
let errors = 0;
let changed = 0;

for (const file of files) {
  try {
    const content = readFileSync(file, 'utf-8');
    const newContent = removeComments(content);
    
    if (content !== newContent) {
      writeFileSync(file, newContent, 'utf-8');
      changed++;
      if (changed % 10 === 0) {
        console.log(`Changed ${changed} files...`);
      }
    }
    processed++;
  } catch (error) {
    console.error(`Error processing ${relative(__dirname, file)}:`, error.message);
    errors++;
  }
}

console.log(`\nDone! Processed ${processed} files, ${changed} files changed, ${errors} errors.`);
