// SPDX-License-Identifier: MIT
// multithreading??!?!?!!?!?!?!?
'use strict';

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { glob } = require('glob');
const os = require('os');

function parsePlatform(pagefile) {
  return pagefile.split(/\//)[1];
}

function parsePagename(pagefile) {
  return pagefile.split(/\//)[2].replace(/\.md$/, '');
}

function parseLanguage(pagefile) {
  let pagesFolder = pagefile.split(/\//)[0];
  return pagesFolder == 'pages' ? 'en' : pagesFolder.replace(/^pages\./, '');
}

function buildPagesIndexWorker(files) {
  let reducer = function (index, file) {
    let os = parsePlatform(file);
    let page = parsePagename(file);
    let language = parseLanguage(file);

    if (index[page]) {
      if (!index[page].platform.includes(os)) {
        index[page].platform.push(os);
      }

      if (!index[page].language.includes(language)) {
        index[page].language.push(language);
      }

      const targets = index[page].targets;
      const exists = targets.some((t) => {return t.platform === os && t.language === language});
      if (!exists) {
        targets.push({os, language});
      }
    } else {
      index[page] = {
        name: page,
        platform: [os],
        language: [language],
        targets: [{os, language}]
      };
    }

    return index;
  };

  let obj = files.reduce(reducer, {});
  return obj;
}

function saveIndex(index) {
  let indexFile = {
    commands: index
  };

  console.log(JSON.stringify(indexFile));
}

if (isMainThread) {
  (async () => {
    const files = await glob('pages*/**/*.md');
    const numCPUs = os.cpus().length;
    const numThreads = Math.max(1, Math.floor(numCPUs / 2)); // Ensure at least one thread
    const chunkSize = Math.ceil(files.length / numThreads);
    const promises = [];

    for (let i = 0; i < numThreads; i++) {
      const chunk = files.slice(i * chunkSize, (i + 1) * chunkSize);
      promises.push(
        new Promise((resolve, reject) => {
          const worker = new Worker(__filename, { workerData: chunk });
          worker.on('message', resolve);
          worker.on('error', reject);
          worker.on('exit', (code) => {
            if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
          });
        })
      );
    }

    Promise.all(promises)
      .then((results) => {
        let mergedIndex = results.reduce((acc, current) => {
          for (const page in current) {
            if (acc[page]) {
              const existing = acc[page];
              const currentData = current[page];
              existing.platform = [...new Set([...existing.platform, ...currentData.platform])];
              existing.language = [...new Set([...existing.language, ...currentData.language])];
              for (const target of currentData.targets) {
                if (!existing.targets.some(t => t.platform === target.platform && t.language === target.language)) {
                  existing.targets.push(target);
                }
              }
            } else {
              acc[page] = current[page];
            }
          }
          return acc;
        }, {});

        let sortedIndex = Object.keys(mergedIndex)
          .sort()
          .map(function(page) {
            return {
              name: page,
              platform: mergedIndex[page].platform,
              language: mergedIndex[page].language,
              targets: mergedIndex[page].targets
            };
          });

        saveIndex(sortedIndex);
      })
      .catch((err) => {
        console.error('ERROR building index!');
        console.error(err);
        process.exit(1);
      });
  })();
} else {
  const partialIndex = buildPagesIndexWorker(workerData);
  parentPort.postMessage(partialIndex);
}
