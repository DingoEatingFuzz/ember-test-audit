# Ember Test Avg

Once upon a time I wanted more insight into how long my tests were taking.

## Usage

```
npx ember-test-audit <iterations: 1> <filter: ''>
```

### JSON output

```
npx ember-test-audit --json
```

This will generate a high-level JSON report with test counts and duration in milliseconds:

```
{
  "passes": 64,
  "failures": 0,
  "flaky": 0,
  "duration": 10016
}
```

## :warning: Alpha software

This worked for my test suite, but it hasn't exactly been battle-hardened yet.
