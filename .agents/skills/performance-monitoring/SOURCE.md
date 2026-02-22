# Performance Monitoring System

## Overview of Changes

The performance monitoring system has been completely rewritten to provide more accurate and detailed metrics.

## Key Improvements

### 1. Statistical Analysis

Instead of one-time measurements, the system now collects data from multiple runs and provides:

- **Minimum** value
- **Maximum** value
- **Mean** value
- **Median** value
- **Standard Deviation** (shows variability)
- **Number** of measurements

### 2. Detailed Measurements

Each module is now measured separately:

- AppPreload
- App
- Auth
- User
- Dictionaries
- Words
- Notification
- Updater
- AppVersion

### 3. Automatic Logging

All metrics are automatically saved to files:

- Location: `~/Library/Application Support/electron-dictionaries/performance-logs/`
- Format: `performance-YYYY-MM-DDTHH-MM-SS.log`
- Includes: timestamps, all measurements, statistics

### 4. Memory Tracking

Detailed information about memory usage:

- Heap Used/Total
- RSS (Resident Set Size)
- External memory
- Memory delta (changes between before/after)

## Usage

### Running with the New Monitoring System

```bash
npm run dev:electron
```

After starting, you will see:

```
================================================================================
🚀 Starting Application Bootstrap with Performance Monitoring
================================================================================

[MEMORY] app-start: heap: X/X MB, rss: X MB, ext: X MB
[PERFORMANCE] module-AppPreload: X.XXms
[PERFORMANCE] module-App: X.XXms
...

================================================================================
PERFORMANCE STATISTICS
================================================================================

📊 module-App:
  Runs:    X
  Mean:    X.XXms
  Median:  X.XXms
  Min:     X.XXms
  Max:     X.XXms
  StdDev:  X.XXms
  Memory Δ: heap X.XXMB, rss X.XXMB

...

================================================================================
📁 Full log saved to: /Users/.../performance-logs/performance-XXX.log
================================================================================

✅ Application ready!
```

### Automatic Testing (Recommended)

For the most accurate results, use the test script:

```bash
./scripts/performance-test.sh
```

This script:

1. Runs the application 5 times
2. Collects all metrics
3. Saves results in `./performance-results/`
4. Allows you to analyze aggregated data

You can change the number of runs by editing the `RUNS` variable in the script.

## Why Are Metrics Always Different?

Variations in metrics are **completely normal** and occur due to:

1. **Garbage Collection (GC)**: V8 can trigger GC at any moment
2. **JIT Compilation**: Code is compiled "on the fly" and cached
3. **OS Caching**: Files may or may not be in the cache
4. **Background Processes**: The OS performs other tasks
5. **Cold vs Warm Start**: The first run is always slower
6. **CPU Throttling**: The processor may reduce frequency to save energy

## How to Interpret Results

### Standard Deviation (StdDev)

- **< 10ms**: Very stable performance ✅
- **10-30ms**: Normal variability ✅
- **> 30ms**: High variability ⚠️ (may indicate an issue)

### Mean vs Median

- If **Mean** and **Median** are close - data is stable
- If **Mean > Median** significantly - there are outliers, possibly due to GC or background processes

### Example Interpretation

```
📊 total-bootstrap:
  Runs:    10
  Mean:    245.32ms
  Median:  240.15ms
  Min:     178.77ms
  Max:     316.73ms
  StdDev:  38.21ms
```

**Analysis:**

- Average time: ~245ms
- Best time: ~179ms (likely a warm start)
- Worst time: ~317ms (possibly a cold start or GC)
- StdDev 38ms - moderate variability, normal for an Electron app

## Tips for More Accurate Measurements

1. **Close other applications** before testing
2. **Plug in your Mac** (disables CPU throttling)
3. **Run 10-20 times** for statistically significant data
4. **Ignore the first 2-3 runs** (warmup period)
5. **Test under consistent conditions** (temperature, system load)

## API Performance Monitor

### Basic Usage

```typescript
const monitor = new PerformanceMonitor();

// Simple measurement
monitor.startMeasure("my-operation");
await doSomething();
monitor.endMeasure("my-operation");

// Measurement with memory
monitor.startMeasure("my-operation", true); // captureMemory = true
await doSomething();
monitor.endMeasure("my-operation", true);

// Show statistics
monitor.printStatistics();

// Show statistics for a specific operation
monitor.printStatistics("my-operation");

// Clear measurements
monitor.clearMeasurements(); // Clear all
monitor.clearMeasurements("my-operation"); // Clear specific

// Get log file path
const logPath = monitor.getLogFilePath();
```

## Project Files

- `src/main/performance-monitor.ts` - PerformanceMonitor class
- `src/main/app.ts` - Integration of monitoring into bootstrap
- `scripts/performance-test.sh` - Script for automatic testing
- Logs: `~/Library/Application Support/electron-dictionaries/performance-logs/`
