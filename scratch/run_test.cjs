const { parseTimelineSource } = require('./test-out/parser.js');
const { computeTimelineLayout } = require('./test-out/layout.js');

const input = `_2027-03-01_09-40_ Mission Start
\tTalk to Captain
\t\tSearch for Clues
\t\t\tConfront Deviant Outside
\t\t\t\tNegotiate
\t\t\t\t\tBe Honest > Deviant Jumps (honesty risks trust)
\t\t\t\t\tBuild Trust > Deviant Jumps
\t\t\t\t\t[[Use Gun Ending]]
\t\t\t\t\t[[Sacrifice Self Ending]] (no return from here)

Deviant Jumps
\t[[Connor Leapt and Fell]]
\t[[Snipers Shot Deviant]]`;

try {
  const tree = parseTimelineSource(input);
  console.log('Parsed roots:', tree.roots.length);
  console.log('Total nodes:', tree.allNodes.size);
  const layout = computeTimelineLayout(tree);
  console.log('Layout nodes:', layout.nodes.length);
  console.log('Layout connectors:', layout.connectors.length);
  console.log('Bounds:', layout.totalWidth, layout.totalHeight);
  console.log('SUCCESS');
} catch (e) {
  console.error('ERROR in parser/layout:', e);
}
