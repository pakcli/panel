import fs from 'fs';

// Read the generated main.js and verify syntax and that getShortcutStartPoint exists
const mainJs = fs.readFileSync('main.js', 'utf8');
console.log('main.js size:', mainJs.length);
console.log('Contains buildDetroitShortcutJumpPath:', mainJs.includes('buildDetroitShortcutJumpPath'));
console.log('Contains getShortcutStartPoint:', mainJs.includes('getShortcutStartPoint'));
console.log('Contains Merge Jumps toggle:', mainJs.includes('Merge Jumps'));
