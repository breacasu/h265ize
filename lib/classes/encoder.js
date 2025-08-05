const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const fs = require('fs').promises;

const colors = require('colors');
const filesize = require('filesize');

const Video = require('./video.js');
const consoleLogger = require('../consoleLogger.js');

/**
 * Optimized Encoder class with modern async/await patterns and performance improvements
 */
class OptimizedEncoder extends EventEmitter {
    constructor(logger = consoleLogger, options = {}) {
        super();
        
        this.logger = logger;
        this.queue = [];
        this.currentlyProcessing = new Set();
        this.failedVideos = [];
        this.finishedVideos = [];
        this.watchIgnore = [];
        
        // Performance optimizations
        this.maxConcurrentJobs = options.maxConcurrentJobs || Math.min(os.cpus().length, 4);
        this.enableMetadataCache = options.enableMetadataCache !== false;
        this.enableProgressReporting = options.enableProgressReporting !== false;
        this.memoryThreshold = options.memoryThreshold || 1024 * 1024 * 1024; // 1GB default
        
        // Hardware acceleration detection
        this.potentialHWAccelSupport = false;
        this.supportedHWAccel = [];
        
        // State management
        this.running = false;
        this.paused = false;
        this.shuttingDown = false;
        
        // Performance metrics
        this.metrics = {
            startTime: null,
            totalFilesProcessed: 0,
            totalBytesProcessed: 0,
            averageProcessingTime: 0,
            memoryUsage: { peak: 0, current: 0 }
        };
        
        this.setupPerformanceMonitoring();
        this.detectHardwareAcceleration();
    }

    /**
     * Setup performance monitoring
     */
    setupPerformanceMonitoring() {
        if (this.enableProgressReporting) {
            this.performanceInterval = setInterval(() => {
                this.updateMetrics();
                this.checkMemoryUsage();
            }, 5000);
        }
    }

    /**
     * Update performance metrics
     */
    updateMetrics() {
        const memUsage = process.memoryUsage();
        this.metrics.memoryUsage.current = memUsage.heapUsed;
        
        if (memUsage.heapUsed > this.metrics.memoryUsage.peak) {
            this.metrics.memoryUsage.peak = memUsage.heapUsed;
        }

        if (this.enableProgressReporting && this.currentlyProcessing.size > 0) {
            this.logger.debug(`Processing: ${this.currentlyProcessing.size} jobs, Memory: ${filesize(memUsage.heapUsed)}`);
        }
    }

    /**
     * Check memory usage and trigger garbage collection if needed
     */
    checkMemoryUsage() {
        const memUsage = process.memoryUsage();
        
        if (memUsage.heapUsed > this.memoryThreshold) {
            this.logger.warn(`High memory usage detected: ${filesize(memUsage.heapUsed)}. Triggering cleanup.`);
            
            if (global.gc) {
                global.gc();
            }
            
            // Reduce concurrent jobs if memory is high
            if (this.maxConcurrentJobs > 1) {
                this.maxConcurrentJobs = Math.max(1, this.maxConcurrentJobs - 1);
                this.logger.info(`Reduced concurrent jobs to ${this.maxConcurrentJobs} due to high memory usage.`);
            }
        }
    }

    /**
     * Modern hardware acceleration detection
     */
    async detectHardwareAcceleration() {
        try {
            const gpuInfo = require('gpu-info');
            const data = await gpuInfo();
            
            if (os.platform() === 'win32') {
                for (const gpu of data) {
                    if (gpu.AdapterCompatibility === 'NVIDIA') {
                        this.potentialHWAccelSupport = true;
                        this.supportedHWAccel.push('nvenc');
                        this.logger.verbose('NVIDIA GPU detected. Hardware acceleration enabled.');
                    }
                    if (gpu.AdapterCompatibility === 'Intel Corporation') {
                        this.potentialHWAccelSupport = true;
                        this.supportedHWAccel.push('qsv');
                        this.logger.verbose('Intel GPU detected. Quick Sync support enabled.');
                    }
                }
            } else if (os.platform() === 'darwin') {
                // macOS VideoToolbox support
                this.potentialHWAccelSupport = true;
                this.supportedHWAccel.push('videotoolbox');
                this.logger.verbose('macOS detected. VideoToolbox support enabled.');
            }
        } catch (error) {
            this.logger.debug('GPU detection error:', error.message);
        }
    }

    /**
     * Add video to encoding queue with optimized path handling
     */
    async addVideo(videoPath, options = {}) {
        try {
            // Validate file existence and permissions
            await fs.access(videoPath, fs.constants.R_OK);
            
            const video = new Video(videoPath, {
                ...options,
                hwAccel: this.supportedHWAccel,
                enableCache: this.enableMetadataCache
            });
            
            this.queue.push(video);
            this.logger.verbose(`Added to queue: ${colors.yellow(path.basename(videoPath))}`);
            
            // Auto-start processing if running
            if (this.running && !this.paused) {
                setImmediate(() => this.processQueue());
            }
            
            return video;
        } catch (error) {
            this.logger.error(`Failed to add video ${videoPath}:`, error.message);
            throw error;
        }
    }

    /**
     * Start the encoder with improved concurrency control
     */
    async start() {
        if (this.running) {
            throw new Error('Encoder is already running');
        }

        this.running = true;
        this.paused = false;
        this.shuttingDown = false;
        this.metrics.startTime = Date.now();

        this.logger.info(`Starting encoder with ${this.maxConcurrentJobs} concurrent jobs...`);
        this.emit('started');

        await this.processQueue();
    }

    /**
     * Optimized queue processing with concurrency control
     */
    async processQueue() {
        while (this.running && !this.paused && !this.shuttingDown) {
            // Check if we can start more jobs
            if (this.currentlyProcessing.size >= this.maxConcurrentJobs || this.queue.length === 0) {
                if (this.queue.length === 0 && this.currentlyProcessing.size === 0) {
                    await this.finish();
                    break;
                }
                
                // Wait for a job to complete before checking again
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }

            // Start processing the next video
            const video = this.queue.shift();
            if (video) {
                this.processVideo(video).catch(error => {
                    this.logger.error(`Unhandled error processing ${video.path}:`, error);
                });
            }
        }
    }

    /**
     * Process individual video with improved error handling
     */
    async processVideo(video) {
        const startTime = Date.now();
        this.currentlyProcessing.add(video);

        try {
            this.logger.info(`Starting: ${colors.yellow(path.basename(video.path))}`);
            
            // Setup progress reporting
            if (this.enableProgressReporting) {
                video.on('progress', (progress) => {
                    this.emit('progress', {
                        video: video.path,
                        progress,
                        concurrent: this.currentlyProcessing.size,
                        queued: this.queue.length
                    });
                });
            }

            // Process the video
            await video.process();
            
            // Success handling
            const processingTime = Date.now() - startTime;
            this.updateProcessingMetrics(video, processingTime);
            
            this.finishedVideos.push({
                path: video.path,
                processingTime,
                inputSize: video.inputSize,
                outputSize: video.outputSize,
                compressionRatio: video.outputSize / video.inputSize
            });

            this.logger.info(`Completed: ${colors.green(path.basename(video.path))} in ${this.formatDuration(processingTime)}`);
            
        } catch (error) {
            this.handleVideoError(video, error);
        } finally {
            this.currentlyProcessing.delete(video);
            
            // Continue processing queue
            if (this.running && !this.paused) {
                setImmediate(() => this.processQueue());
            }
        }
    }

    /**
     * Handle video processing errors with detailed logging
     */
    handleVideoError(video, error) {
        this.logger.error(`Failed to process ${colors.red(path.basename(video.path))}: ${error.message}`);
        
        this.failedVideos.push({
            path: video.path,
            base: path.basename(video.path),
            error: error.message,
            timestamp: new Date().toISOString(),
            stage: video.currentStage?.name || 'Unknown'
        });

        this.emit('videoFailed', {
            video: video.path,
            error: error.message
        });
    }

    /**
     * Update processing metrics
     */
    updateProcessingMetrics(video, processingTime) {
        this.metrics.totalFilesProcessed++;
        this.metrics.totalBytesProcessed += video.inputSize || 0;
        
        // Calculate rolling average
        const currentAverage = this.metrics.averageProcessingTime;
        const count = this.metrics.totalFilesProcessed;
        this.metrics.averageProcessingTime = ((currentAverage * (count - 1)) + processingTime) / count;
    }

    /**
     * Pause encoding with graceful handling
     */
    async pause() {
        if (!this.running || this.paused) {
            throw new Error('Encoder is not running or already paused');
        }

        this.paused = true;
        this.logger.info('Pausing encoder after current jobs complete...');

        // Pause all currently processing videos
        for (const video of this.currentlyProcessing) {
            if (typeof video.pause === 'function') {
                await video.pause();
            }
        }

        this.emit('paused');
    }

    /**
     * Resume encoding
     */
    async resume() {
        if (!this.paused) {
            throw new Error('Encoder is not paused');
        }

        this.paused = false;
        this.logger.info('Resuming encoder...');

        // Resume all paused videos
        for (const video of this.currentlyProcessing) {
            if (typeof video.resume === 'function') {
                await video.resume();
            }
        }

        this.emit('resumed');
        await this.processQueue();
    }

    /**
     * Stop encoding with graceful shutdown
     */
    async stop() {
        if (!this.running) {
            return;
        }

        this.shuttingDown = true;
        this.logger.info('Stopping encoder gracefully...');

        // Stop all currently processing videos
        const stopPromises = Array.from(this.currentlyProcessing).map(async (video) => {
            if (typeof video.stop === 'function') {
                await video.stop();
            }
        });

        await Promise.allSettled(stopPromises);
        
        this.running = false;
        this.paused = false;
        this.currentlyProcessing.clear();
        
        this.cleanup();
        this.emit('stopped');
    }

    /**
     * Finish processing with comprehensive reporting
     */
    async finish() {
        const totalTime = Date.now() - this.metrics.startTime;
        
        this.logger.info(colors.green('✓ All videos processed!'));
        
        if (this.finishedVideos.length > 0) {
            const totalInputSize = this.finishedVideos.reduce((sum, v) => sum + (v.inputSize || 0), 0);
            const totalOutputSize = this.finishedVideos.reduce((sum, v) => sum + (v.outputSize || 0), 0);
            const avgCompressionRatio = totalOutputSize / totalInputSize;
            
            this.logger.info(`Processing Summary:
                - Files processed: ${this.finishedVideos.length}
                - Total time: ${this.formatDuration(totalTime)}
                - Average time per file: ${this.formatDuration(this.metrics.averageProcessingTime)}
                - Total input size: ${filesize(totalInputSize)}
                - Total output size: ${filesize(totalOutputSize)}
                - Compression ratio: ${(avgCompressionRatio * 100).toFixed(1)}%
                - Space saved: ${filesize(totalInputSize - totalOutputSize)}
                - Peak memory usage: ${filesize(this.metrics.memoryUsage.peak)}`);
        }

        if (this.failedVideos.length > 0) {
            this.logger.error(`${this.failedVideos.length} videos failed to process:`);
            this.failedVideos.forEach(video => {
                this.logger.error(`  - ${colors.red(video.base)}: ${video.error}`);
            });
        }

        this.running = false;
        this.cleanup();
        this.emit('finished', {
            processed: this.finishedVideos.length,
            failed: this.failedVideos.length,
            totalTime,
            metrics: this.metrics
        });
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        if (this.performanceInterval) {
            clearInterval(this.performanceInterval);
            this.performanceInterval = null;
        }
    }

    /**
     * Format duration in human-readable format
     */
    formatDuration(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    /**
     * Get current encoder status
     */
    getStatus() {
        return {
            running: this.running,
            paused: this.paused,
            shuttingDown: this.shuttingDown,
            queue: this.queue.length,
            processing: this.currentlyProcessing.size,
            completed: this.finishedVideos.length,
            failed: this.failedVideos.length,
            maxConcurrent: this.maxConcurrentJobs,
            metrics: { ...this.metrics },
            hwAccelSupport: this.potentialHWAccelSupport,
            supportedHWAccel: [...this.supportedHWAccel]
        };
    }
}

module.exports = OptimizedEncoder;
