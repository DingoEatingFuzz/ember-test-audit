# Ember Test Avg

Once upon a time I wanted more insight into how long my tests were taking.

## Usage

This is terrible and there's probably a better way to do this, but here's what I do.

1. Clone the project
2. `npm link` in the project dir
3. `npm link ember-test-avg` in your ember dir
4. Create and run a node script with the following in it `require('ember-test-avg');`
5. Run it like `node myscript.js <iterations: 1> <filter: ''>`

The script reads from `process.argv`, so I don't think something like `node -r ember-test-avg` would work.

## Dream Usage

The dream is to have this be an Ember Addon that hooks into Ember CLI and adds a new subcommand. Then you could do something like:

```sh
$ ember test-audit --count=3
```

Some day!
