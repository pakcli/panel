import { parseTimelineSource } from './test-bundle-esm/parser.js';
import { computeTimelineLayout } from './test-bundle-esm/layout.js';

const source = `_2027-03-01_09-40_ Mission Start
\tTalk to Captain
\t\tSearch for Clues
\t\t\tConfront Deviant Outside
\t\t\t\tNegotiate
\t\t\t\t\tBe Honest > Deviant Jumps (honesty risks trust)
\t\t\t\t\t\tNew Choice
\t\t\t\t\tBuild Trust > Deviant Jumps
\t\t\t\t\t[[Use Gun Ending]]
\t\t\t\t\t[[Sacrifice Self Ending]] (no return from here)

Deviant Jumps
\t[[Connor Leapt and Fell]]
\t[[Snipers Shot Deviant]]

Negotiate > Deviant Jumps`;

const tree = parseTimelineSource(source);

console.log('=== NODES (MERGED MODE) ===');
const mergedLayout = computeTimelineLayout(tree, { mergeJumps: true });
mergedLayout.nodes.forEach(n => {
  console.log(`${n.node.label.padEnd(25)} | col: ${n.column} | x: ${n.x}, y: ${n.y}, w: ${n.width}, h: ${n.height}`);
});

console.log('\n=== CONNECTORS (MERGED MODE) ===');
mergedLayout.connectors.forEach(c => {
  const from = mergedLayout.nodes.find(n => n.node.id === c.fromNodeId)?.node.label;
  const to = mergedLayout.nodes.find(n => n.node.id === c.toNodeId)?.node.label;
  console.log(`${from?.padEnd(20)} -> ${to?.padEnd(20)} [jump: ${c.isJump}] start: (${c.startX}, ${c.startY}) end: (${c.endX}, ${c.endY})`);
  console.log('   d =', c.d);
});
