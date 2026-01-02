const testCode = `

const x = 1;
const y = "

const z = \`\`;
`;

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

const result = removeComments(testCode);
console.log('Original:');
console.log(testCode);
console.log('\nAfter removing comments:');
console.log(result);

