import { parseTimelineSource } from './test-bundle-esm/parser.js';

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
console.log('Parsed tree successfully, roots:', tree.roots.length);
