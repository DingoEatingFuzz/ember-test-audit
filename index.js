#!/usr/bin/env node

const { spawn } = require('child_process');
const tapJsonParser = require('tap-json');
const { Readable } = require('stream');
const { groupBy, flatten, sortBy } = require('lodash');
const chalk = require('chalk');
const { log } = console;
const { EOL } = require('os');
const fs = require('fs');

return main();

function main() {
  const ts = Date.now();
  const count = process.argv[2] || 1;
  const filter = process.argv[3] || '';
  // console.log(`Starting. Count: ${count} Filter: "${filter}"`);

  // Collect the output of N test runs
  // const runs = await serial(count, () => runTests(filter));
  // const json = await Promise.all(runs.map(run => asJson(run.stdout)));

  const reporter = { current: 1 };
  const spinner = setInterval(() => {
    if (process.stdout.isTTY) {
      process.stdout.clearLine();
      process.stdout.cursorTo(0);
    }
    process.stdout.write(
      `Running... (${reporter.current}/${count}) ${humanDuration(Date.now() - ts)}`
    );
  }, 1000);
  return serial(count, () => runTests(filter), reporter)
    .then(runs => {
      clearInterval(spinner);
      if (process.stdout.isTTY) {
        process.stdout.clearLine();
        process.stdout.cursorTo(0);
      }
      return Promise.all(runs.map(run => asJson(run.stdout)));
    })
    .then(json => {
      json.forEach(addMetadata);
      const aggregation = aggregateTimings(json);
      fs.writeFileSync(`./test-timings-${ts}`, getComplete(aggregation));
      printSummary(aggregation);
      log('');
      log(chalk.bold(`Full audit written to file ./test-timings-${ts}`));
    })
    .catch(err => {
      log('Bad exit: ', err);
    });
}

function all(promises, cb) {
  const total = promises.length;
  let returns = [];
  let handler = v => {
    returns.push(v);
    if (returns.length >= total) {
      cb(returns);
    }
  };
  promises.forEach(p => {
    p.then(handler).catch(handler);
  });
}

function runTests(filter) {
  return new Promise((resolve, reject) => {
    const runner = spawn('ember', ['test', `-f=${filter}`]);
    // const runner = spawn('cat', ['out']);
    const stdout = [];
    const stderr = [];
    runner.stdout.on('data', d => stdout.push(d.toString()));
    runner.stderr.on('data', d => stderr.push(d.toString()));
    runner.on('exit', () => resolve({ stdout: stdout.join(''), stderr: stderr.join('') }));
  });
}

function asJson(tapOutput) {
  // run tapOutput through the tap-json module
  return new Promise((resolve, reject) => {
    const stream = new Readable();
    stream.setEncoding('utf8');
    stream._read = () => {};
    stream.push(tapOutput);
    stream.push(null);

    const json = tapJsonParser();
    stream.pipe(json);

    const chunks = [];
    json.on('data', chunk => {
      chunks.push(chunk);
    });

    stream.on('end', () => {
      resolve(chunks);
    });
    stream.on('error', err => {
      reject(err);
    });
  });
}

function addMetadata(tapJson) {
  // extract browser, timing, and module
  tapJson.forEach(frame => {
    frame.asserts.forEach(assertion => {
      const { name } = assertion;
      const matches = name.match(/^(.+?)\s-\s\[(\d+) ms\] - (.+?): (.+)$/);
      if (matches) {
        const [, browser, duration, module, test] = matches;
        Object.assign(assertion, {
          browser,
          module,
          test,
          duration: +duration,
          id: `${module}: ${test}`,
        });
      }
    });
  });

  return tapJson;
}

function aggregateTimings(tapJson) {
  const isAverage = tapJson.length > 1;
  let joined = flatten(tapJson.map(tap => flatten(tap.map(t => t.asserts))));
  if (isAverage) {
    joined = Object.values(groupBy(joined, 'id')).map(mergeAssertions);
  }
  const timings = { all: joined, modules: groupBy(joined, 'module') };
  timings.modules = Object.keys(timings.modules).map(key =>
    rollupModule(key, timings.modules[key])
  );
  return timings;
}

function mergeAssertions(assertions) {
  const passing = assertions.filter(a => a.ok);
  const passes = passing.length;
  const failures = assertions.length - passes;
  const avg = Math.round(passing.reduce((sum, a) => sum + a.duration, 0) / passes);

  const aggregate = Object.assign({ passes, failures, avg }, assertions[0]);
  aggregate.durations = assertions.map(a => a.duration);
  aggregate.name = aggregate.id;
  delete aggregate.ok;
  delete aggregate.duration;

  return aggregate;
}

function rollupModule(name, tests) {
  const stats = Object.assign(statsFor(tests), {
    module: name,
    tests,
  });

  stats.avg = Math.round(stats.duration / tests.length);
  return stats;
}

function statsFor(tests) {
  const stats = {
    passes: 0,
    failures: 0,
    flaky: 0,
    duration: 0,
  };

  tests.forEach(a => {
    if (a.passes > 0 && a.failures > 0) {
      stats.flaky++;
    } else if (a.passes > 0) {
      stats.passes++;
    } else {
      stats.failures++;
    }
    stats.duration += a.avg;
  });

  return stats;
}

function printSummary(aggregation) {
  const stats = statsFor(aggregation.all);

  let details = '';
  if (stats.flaky && stats.failures) {
    details = ` (${withCommas(stats.failures)} failures, ${withCommas(stats.flaky)} flaky)`;
  } else if (stats.flaky) {
    details = ` (${withCommas(stats.flaky)} flaky)`;
  } else if (stats.failures) {
    details = ` (${withCommas(stats.failures)} failures)`;
  }

  const formattedTotalTests = withCommas(stats.passes + stats.failures + stats.flaky);
  const formattedTotalTime = `${withCommas(stats.duration)}ms (${humanDuration(stats.duration)})`;
  log(
    chalk.bold(`Total Tests: ${formattedTotalTests}${details} Total Time: ${formattedTotalTime}`)
  );

  log('');
  log(chalk.bold('Slowest Modules (avg)'));
  const slowestModules = sortBy(aggregation.modules, ['avg'])
    .reverse()
    .slice(0, 10);
  slowestModules.forEach(module => {
    let method = 'green';
    if (module.avg > 800) {
      method = 'yellow';
    }
    if (module.avg > 3000) {
      method = 'red';
    }
    const formattedAvg = chalk[method](humanDuration(module.avg));
    const formattedTotal = chalk.bold(humanDuration(module.duration));
    log(`${formattedAvg} avg per test (${formattedTotal} total): ${chalk.gray(module.module)}`);
  });

  log('');
  log(chalk.bold('Slowest Tests (avg)'));
  const slowestTests = sortBy(aggregation.all, ['avg'])
    .reverse()
    .slice(0, 10);
  slowestTests.forEach(test => {
    let method = 'green';
    if (test.avg > 1000) {
      method = 'yellow';
    }
    if (test.avg > 5000) {
      method = 'red';
    }
    log(`${chalk[method](humanDuration(test.avg))}: ${chalk.gray(test.name)}`);
  });
}

function getComplete(aggregation) {
  const file = [];
  const stats = statsFor(aggregation.all);

  let details = '';
  if (stats.flaky && stats.failures) {
    details = ` (${withCommas(stats.failures)} failures, ${withCommas(stats.flaky)} flaky)`;
  } else if (stats.flaky) {
    details = ` (${withCommas(stats.flaky)} flaky)`;
  } else if (stats.failures) {
    details = ` (${withCommas(stats.failures)} failures)`;
  }

  const formattedTotalTests = withCommas(stats.passes + stats.failures + stats.flaky);
  const formattedTotalTime = `${withCommas(stats.duration)}ms (${humanDuration(stats.duration)})`;
  file.push(`Total Tests: ${formattedTotalTests}${details} Total Time: ${formattedTotalTime}`);

  file.push('');
  file.push('Modules (avg)');
  const modules = sortBy(aggregation.modules, ['avg']).reverse();
  modules.forEach(module => {
    const formattedAvg = humanDuration(module.avg);
    const formattedTotal = humanDuration(module.duration);
    file.push(`${formattedAvg} avg per test (${formattedTotal} total): ${module.module}`);
  });

  file.push('');
  file.push('Tests (avg)');
  const tests = sortBy(aggregation.all, ['avg']).reverse();
  tests.forEach(test => {
    file.push(`${humanDuration(test.avg)}: ${test.name}`);
  });

  return file.join(EOL);
}

async function serial(count, fn, reporter = {}) {
  const returnValues = [];
  for (let i = 0; i < count; i++) {
    reporter.current = i + 1;
    try {
      const ret = await fn();
      returnValues.push(ret);
    } catch (err) {
      log('Failed to perform serial action:', err);
    }
  }
  return returnValues;
}

function withCommas(number) {
  let str = number.toString();
  let [whole, decimal] = str.split('.');

  whole = whole.split('');
  for (let i = whole.length - 3; i > 0; i -= 3) {
    whole.splice(i, 0, ',');
  }

  whole = whole.join('');
  return decimal ? whole + '.' + decimal : whole;
}

function humanDuration(duration) {
  const ms = duration % 1000;
  const s = Math.floor((duration / 1000) % 60);
  const m = Math.floor(duration / 1000 / 60);

  const fs = s < 10 ? `0${s}` : `${s}`;
  const fms = ms < 10 ? `00${ms}` : ms < 100 ? `0${ms}` : `${ms}`;

  if (m) return `${m}m ${fs}s ${fms}ms`;
  else if (s) return `${fs}s ${fms}ms`;
  return `${fms}ms`;
}
