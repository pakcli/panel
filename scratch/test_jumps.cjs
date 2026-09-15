const { parseTimelineSource } = require('./test-bundle/parser.js');
const { computeTimelineLayout } = require('./test-bundle/layout.js');

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
console.log('Roots count:', tree.roots.length);
const negotiate = tree.nodesByLabel.get('Negotiate')[0];
console.log('Negotiate jump targets:', negotiate.jumpTargets);

console.log('\n--- UNMERGED MODE ---');
const layout = computeTimelineLayout(tree, { mergeJumps: false });
const jumps = layout.connectors.filter(c => c.isJump);
console.log('Unmerged jumps count:', jumps.length);
jumps.forEach(j => {
  const fromNode = Array.from(tree.allNodes).find(n => n.id === j.fromNodeId);
  const toNode = Array.from(tree.allNodes).find(n => n.id === j.toNodeId);
  console.log(`Jump from '${fromNode?.label}' (${j.startX}, ${j.startY}) -> '${toNode?.label}' (${j.endX}, ${j.endY})`);
  console.log('  path d:', j.d);
});

console.log('\n--- MERGED MODE ---');
const mergedLayout = computeTimelineLayout(tree, { mergeJumps: true });
const mergedJumps = mergedLayout.connectors.filter(c => c.isJump);
console.log('Merged jumps count:', mergedJumps.length);
mergedJumps.forEach(j => {
  const fromNode = Array.from(tree.allNodes).find(n => n.id === j.fromNodeId);
  const toNode = Array.from(tree.allNodes).find(n => n.id === j.toNodeId);
  console.log(`Merged Jump from '${fromNode?.label}' (${j.startX}, ${j.startY}) -> '${toNode?.label}' (${j.endX}, ${j.endY})`);
  console.log('  path d:', j.d);
});
