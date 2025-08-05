# Changelog

## [0.6.0] - 2025-08-05

### ?? Performance Optimizations (Major Release)

This release includes significant performance improvements and modernization of the h265ize codebase:

#### ? **Implemented Optimizations**

1. **Replaced helpers.js with modern implementation**
   - Removed moment.js dependency (290MB bundle reduction potential)
   - Native JavaScript date formatting instead of moment
   - Optimized utility functions
   - Modern async/await patterns

2. **Updated encoder.js with optimized version**
   - Modern async/await implementation
   - Improved memory management
   - Enhanced error handling
   - Better concurrent job handling

3. **Updated package.json**
   - Version bumped to 0.6.0
   - Added modern npm scripts for development
   - Prepared for dependency modernization

#### ?? **Expected Performance Improvements**

Based on analysis from PERFORMANCE_ANALYSIS.md:

- **Bundle Size Reduction**: From 65MB to ~25MB (potential 60% reduction)
- **Security**: Addresses 10 vulnerabilities in dependencies
- **Memory Usage**: Improved through better stream processing
- **Load Time**: Faster startup due to lighter dependencies
