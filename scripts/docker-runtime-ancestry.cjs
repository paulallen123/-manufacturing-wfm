'use strict';
// Follow only FROM ancestry; sibling verification stages do not enter the image.
function runtimeStageAncestry(docker) {
  const stages = [];
  const aliases = new Map();
  for (const match of docker.matchAll(/^FROM[ \t]+([^\r\n]+)\r?\n([\s\S]*?)(?=^FROM[ \t]+|(?![\s\S]))/gm)) {
    const words = match[1].trim().split(/\s+/);
    const parent = aliases.get(words[0]);
    const stage = (parent === undefined ? '' : stages[parent] + '\n') + match[0];
    stages.push(stage);
    if (words.length === 3 && words[1] === 'AS') aliases.set(words[2], stages.length - 1);
  }
  return stages.at(-1) || '';
}
module.exports = {runtimeStageAncestry};
