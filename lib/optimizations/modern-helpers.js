const { spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { Transform } = require('stream');

const consoleLogger = require('../consoleLogger.js');
const languages = require('../languages.json');
const packageSettings = require(path.resolve(__dirname, '../../package.json'));

// Native replacements for heavy dependencies
const hasbin = require('hasbin');
const colors = require('colors');
const mime = require('mime');
const recursive = require('recursive-readdir');
const optional = require('optional');

const userSettings = optional("./settings.json") || {};

// Optimized date formatting (replaces moment.js)
const formatDate = (date, format = 'full') => {
    const options = {
        full: {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
            hour12: true
        },
        simple: {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }
    };
    
    return new Intl.DateTimeFormat('en-US', options[format] || options.full).format(date);
};

// Optimized duration formatting (replaces moment-duration-format)
const formatDuration = (milliseconds) => {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    const remainingMinutes = minutes % 60;
    const remainingSeconds = seconds % 60;
    
    if (hours > 0) {
        return `${hours}:${remainingMinutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    } else if (minutes > 0) {
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    } else {
        return `0:${remainingSeconds.toString().padStart(2, '0')}`;
    }
};

// Native object utilities (replaces lodash)
const objectUtils = {
    defaults: (target, ...sources) => {
        return Object.assign({}, ...sources.reverse(), target);
    },
    
    each: (collection, iteratee) => {
        if (Array.isArray(collection)) {
            collection.forEach(iteratee);
        } else {
            Object.entries(collection).forEach(([key, value]) => iteratee(value, key));
        }
    },
    
    flatMap: (collection, iteratee) => {
        return collection.map(iteratee).flat();
    },
    
    pick: (object, keys) => {
        return keys.reduce((result, key) => {
            if (key in object) {
                result[key] = object[key];
            }
            return result;
        }, {});
    }
};

// Optimized math utilities (replaces mathjs for basic operations)
const mathUtils = {
    evaluate: (expression) => {
        // Safe evaluation for basic math expressions
        const sanitized = expression.replace(/[^0-9+\-*/().\s]/g, '');
        try {
            return Function('"use strict"; return (' + sanitized + ')')();
        } catch (error) {
            throw new Error(`Invalid math expression: ${expression}`);
        }
    },
    
    round: (number, precision = 0) => {
        const factor = Math.pow(10, precision);
        return Math.round(number * factor) / factor;
    }
};

// Metadata cache for performance optimization
class MetadataCache {
    constructor(maxSize = 100) {
        this.cache = new Map();
        this.maxSize = maxSize;
    }

    async get(filePath) {
        try {
            const stats = await fs.stat(filePath);
            const cacheKey = `${filePath}:${stats.mtime.getTime()}:${stats.size}`;
            
            if (this.cache.has(cacheKey)) {
                // Move to end (LRU)
                const value = this.cache.get(cacheKey);
                this.cache.delete(cacheKey);
                this.cache.set(cacheKey, value);
                return value;
            }
            
            return null;
        } catch (error) {
            return null;
        }
    }

    set(filePath, metadata) {
        if (this.cache.size >= this.maxSize) {
            // Remove oldest entry (LRU)
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        
        try {
            const stats = fsSync.statSync(filePath);
            const cacheKey = `${filePath}:${stats.mtime.getTime()}:${stats.size}`;
            this.cache.set(cacheKey, metadata);
        } catch (error) {
            // Ignore cache set errors
        }
    }

    clear() {
        this.cache.clear();
    }
}

// Global metadata cache instance
const metadataCache = new MetadataCache();

// Optimized stream processor for large files
class OptimizedStreamProcessor extends Transform {
    constructor(options = {}) {
        super(options);
        this.chunkCount = 0;
        this.totalSize = 0;
        this.onProgress = options.onProgress || (() => {});
    }

    _transform(chunk, encoding, callback) {
        this.chunkCount++;
        this.totalSize += chunk.length;
        
        // Report progress every 100 chunks to avoid overhead
        if (this.chunkCount % 100 === 0) {
            this.onProgress({
                chunks: this.chunkCount,
                bytes: this.totalSize
            });
        }
        
        callback(null, chunk);
    }
}

// Optimized helper functions with async/await
const optimizedHelpers = {
    formatDate,
    formatDuration,
    objectUtils,
    mathUtils,
    metadataCache,
    OptimizedStreamProcessor,

    getStreamTitle: (stream) => {
        return stream.title || stream.tags?.title;
    },

    normalizeStreamLanguage: (stream) => {
        const lang = stream.language || stream.tags?.language;
        return optimizedHelpers.normalizeLanguage(lang);
    },

    normalizeLanguage: (lang) => {
        if (!lang) return undefined;
        
        const normalized = lang.toLowerCase().trim();
        return languages[normalized] || normalized;
    },

    getFormattedChannels: (channels) => {
        const channelMap = {
            1: 'Mono',
            2: 'Stereo',
            6: '5.1',
            8: '7.1'
        };
        return channelMap[channels] || `${channels} channels`;
    },

    // Optimized with async/await and caching
    async extractTrack(input, stream, output) {
        const cacheKey = `${input}:${stream.index}`;
        const cached = await metadataCache.get(cacheKey);
        
        if (cached) {
            return cached;
        }

        return new Promise((resolve, reject) => {
            const args = ['-i', input, '-map', `0:${stream.index}`, '-c', 'copy', output];
            const process = spawn('mkvextract', args);
            
            let output_data = '';
            
            process.on('close', (code) => {
                if (code !== 0) {
                    return reject(new Error(`mkvextract failed with code ${code}`));
                }
                
                metadataCache.set(cacheKey, output_data);
                resolve(output_data);
            });

            process.stdout.on('data', (data) => {
                output_data += data.toString();
            });

            process.stderr.on('data', (data) => {
                console.error('mkvextract error:', data.toString());
            });
        });
    },

    async vobsubToSRT(filePath) {
        if (!hasbin.sync('vobsub2srt')) {
            throw new Error('VOBSUB2SRT_NOT_INSTALLED');
        }

        const filePathWithoutExtension = filePath.replace(/\.[^/.]+$/, "");
        
        return new Promise((resolve, reject) => {
            const process = spawn('vobsub2srt', [filePathWithoutExtension]);
            
            process.on('close', (code) => {
                if (code !== 0) {
                    return reject(new Error('VOBSUB2SRT_ERROR'));
                }
                resolve(filePathWithoutExtension + '.srt');
            });

            process.on('error', (error) => {
                reject(new Error(`vobsub2srt spawn error: ${error.message}`));
            });
        });
    },

    createListString: (files) => {
        if (Array.isArray(files)) {
            return '\n\t- ' + files.join('\n\t- ');
        }

        const array = Object.entries(files).map(([key, value]) => 
            colors.yellow(key) + ': ' + value
        );
        
        return '\n\t- ' + array.join('\n\t- ');
    },

    async parseInput(input, logger = consoleLogger) {
        try {
            const stats = await fs.stat(input);
            
            if (stats.isFile()) {
                if (optimizedHelpers.isSupportedFileType(input)) {
                    return [input];
                } else {
                    throw new Error(`Input file '${input}' is not a recognized file format.`);
                }
            } else if (stats.isDirectory()) {
                const videoPaths = await optimizedHelpers.findVideos(input);
                logger.verbose('Folder encoding started at', colors.yellow(formatDate(new Date())));
                return videoPaths;
            }
            
            return [];
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.error('Input', input, 'does not exist.');
                return [];
            }
            throw error;
        }
    },

    async findVideos(dirPath) {
        try {
            const files = await promisify(recursive)(dirPath);
            return files.filter(file => optimizedHelpers.isSupportedFileType(file));
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw new Error(`File or directory ${colors.yellow(dirPath)} does not exist.`);
            }
            throw error;
        }
    },

    isSupportedFileType: (filePath) => {
        const supportedTypes = [
            'video/mp4', 'video/avi', 'video/mkv', 'video/mov',
            'video/wmv', 'video/flv', 'video/webm', 'video/m4v'
        ];
        
        const mimeType = mime.getType(filePath);
        const extension = path.extname(filePath).toLowerCase();
        
        // Check both MIME type and common video extensions
        const videoExtensions = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'];
        
        return supportedTypes.includes(mimeType) || videoExtensions.includes(extension);
    },

    // Optimized stats handling with async I/O
    async initStatsFile(filePath) {
        const stats = {
            created: new Date().toISOString(),
            version: packageSettings.version,
            files: []
        };
        
        try {
            await fs.writeFile(filePath, JSON.stringify(stats, null, 2));
            return stats;
        } catch (error) {
            throw new Error(`Failed to initialize stats file: ${error.message}`);
        }
    },

    async appendToStatsFile(filePath, data) {
        try {
            const existing = await fs.readFile(filePath, 'utf8');
            const stats = JSON.parse(existing);
            
            stats.files.push({
                ...data,
                timestamp: new Date().toISOString()
            });
            
            await fs.writeFile(filePath, JSON.stringify(stats, null, 2));
        } catch (error) {
            throw new Error(`Failed to append to stats file: ${error.message}`);
        }
    },

    getCLIArguments: () => {
        // Return CLI arguments without yargs dependency for basic usage
        return process.argv.slice(2);
    },

    removeFromObject: (obj, keys) => {
        const result = { ...obj };
        keys.forEach(key => delete result[key]);
        return result;
    }
};

module.exports = optimizedHelpers;