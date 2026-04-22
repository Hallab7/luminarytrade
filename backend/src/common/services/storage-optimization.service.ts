/**
 * Storage Optimization Service
 * 
 * Provides compression and efficient serialization for smart contract storage:
 * - Value encoding: dates as block heights (u32 vs timestamp)
 * - Efficient serialization for various data types
 * - Compression utilities for stored data
 */

import { Injectable } from '@nestjs/common';

// Block height type for date encoding
export type BlockHeight = number;

// Compression result interface
export interface CompressionResult {
  data: Buffer;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  algorithm: CompressionAlgorithm;
}

// Supported compression algorithms
export enum CompressionAlgorithm {
  NONE = 'none',
  GZIP = 'gzip',
  ZSTD = 'zstd',
  LZ4 = 'lz4',
}

// Serialization types
export enum SerializationType {
  JSON = 'json',
  CBOR = 'cbor',
  MESSAGE_PACK = 'messagepack',
  PROTOBUF = 'protobuf',
}

// Encoded value types
export enum EncodedType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  DATE_AS_BLOCK_HEIGHT = 'date_as_block_height',
  TIMESTAMP = 'timestamp',
  BIG_INT = 'bigint',
  BLOB = 'blob',
}

// Storage optimization configuration
export interface StorageOptimizationConfig {
  defaultCompression: CompressionAlgorithm;
  defaultSerialization: SerializationType;
  compressThreshold: number; // bytes
  enableDateEncoding: boolean;
}

// Default configuration
const DEFAULT_CONFIG: StorageOptimizationConfig = {
  defaultCompression: CompressionAlgorithm.GZIP,
  defaultSerialization: SerializationType.JSON,
  compressThreshold: 1024, // 1KB
  enableDateEncoding: true,
};

@Injectable()
export class StorageOptimizationService {
  private config: StorageOptimizationConfig;

  constructor() {
    this.config = DEFAULT_CONFIG;
  }

  /**
   * Initialize with custom configuration
   */
  initialize(config: Partial<StorageOptimizationConfig>): void {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Encode a date as block height (u32)
   * This is more efficient than storing full timestamps
   * 
   * @param date - The date to encode
   * @param currentBlockHeight - Current block height for reference
   * @param blocksPerDay - Average blocks per day (default: 1440 for ~10s block time)
   * @returns Block height number (u32)
   */
  encodeDateAsBlockHeight(
    date: Date,
    currentBlockHeight: number,
    blocksPerDay: number = 1440,
  ): BlockHeight {
    const now = Date.now();
    const targetTime = date.getTime();
    const timeDiff = now - targetTime;
    
    // Calculate days difference
    const daysDiff = Math.floor(timeDiff / (24 * 60 * 60 * 1000));
    
    // Convert to block height offset
    const blockOffset = daysDiff * blocksPerDay;
    
    // Return as current block height minus offset
    return Math.max(0, currentBlockHeight - blockOffset) as BlockHeight;
  }

  /**
   * Decode a block height back to approximate date
   * 
   * @param blockHeight - The block height to decode
   * @param currentBlockHeight - Current block height for reference
   * @param blocksPerDay - Average blocks per day
   * @returns Approximate Date
   */
  decodeBlockHeightToDate(
    blockHeight: BlockHeight,
    currentBlockHeight: number,
    blocksPerDay: number = 1440,
  ): Date {
    const blockDiff = currentBlockHeight - blockHeight;
    const daysDiff = Math.floor(blockDiff / blocksPerDay);
    
    const estimatedTime = Date.now() - (daysDiff * 24 * 60 * 60 * 1000);
    return new Date(estimatedTime);
  }

  /**
   * Serialize data with specified serialization type
   */
  serialize(data: any, type: SerializationType = this.config.defaultSerialization): string | Buffer {
    switch (type) {
      case SerializationType.JSON:
        return JSON.stringify(data);
      
      case SerializationType.CBOR:
        // CBOR encoding would require a library like 'cbor'
        // For now, fallback to JSON
        return JSON.stringify(data);
      
      case SerializationType.MESSAGE_PACK:
        // MessagePack encoding would require 'msgpack' library
        // For now, fallback to JSON
        return JSON.stringify(data);
      
      case SerializationType.PROTOBUF:
        // Protobuf would require 'protobufjs' library
        // For now, fallback to JSON
        return JSON.stringify(data);
      
      default:
        return JSON.stringify(data);
    }
  }

  /**
   * Deserialize data from specified serialization type
   */
  deserialize(data: string | Buffer, type: SerializationType = this.config.defaultSerialization): any {
    const input = typeof data === 'string' ? data : data.toString();
    
    switch (type) {
      case SerializationType.JSON:
        return JSON.parse(input);
      
      case SerializationType.CBOR:
      case SerializationType.MESSAGE_PACK:
      case SerializationType.PROTOBUF:
        // Fallback to JSON
        return JSON.parse(input);
      
      default:
        return JSON.parse(input);
    }
  }

  /**
   * Compress data using specified algorithm
   */
  compress(
    data: string | Buffer,
    algorithm: CompressionAlgorithm = this.config.defaultCompression,
  ): CompressionResult {
    const inputBuffer = typeof data === 'string' ? Buffer.from(data) : data;
    const originalSize = inputBuffer.length;

    // For data below threshold, return as-is
    if (originalSize < this.config.compressThreshold && algorithm !== CompressionAlgorithm.NONE) {
      return {
        data: inputBuffer,
        originalSize,
        compressedSize: originalSize,
        compressionRatio: 1,
        algorithm: CompressionAlgorithm.NONE,
      };
    }

    let compressed: Buffer;

    switch (algorithm) {
      case CompressionAlgorithm.GZIP:
        compressed = this.gzipCompress(inputBuffer);
        break;
      
      case CompressionAlgorithm.ZSTD:
        // Zstd would require 'zstd' library
        // Fallback to gzip
        compressed = this.gzipCompress(inputBuffer);
        break;
      
      case CompressionAlgorithm.LZ4:
        // LZ4 would require 'lz4' library
        // Fallback to gzip
        compressed = this.gzipCompress(inputBuffer);
        break;
      
      case CompressionAlgorithm.NONE:
      default:
        compressed = inputBuffer;
        break;
    }

    const compressedSize = compressed.length;
    const compressionRatio = originalSize / compressedSize;

    return {
      data: compressed,
      originalSize,
      compressedSize,
      compressionRatio,
      algorithm: compressedSize < originalSize ? algorithm : CompressionAlgorithm.NONE,
    };
  }

  /**
   * Decompress data
   */
  decompress(data: Buffer, algorithm: CompressionAlgorithm): Buffer {
    switch (algorithm) {
      case CompressionAlgorithm.GZIP:
        return this.gzipDecompress(data);
      
      case CompressionAlgorithm.ZSTD:
      case CompressionAlgorithm.LZ4:
        // Fallback to gzip
        return this.gzipDecompress(data);
      
      case CompressionAlgorithm.NONE:
      default:
        return data;
    }
  }

  /**
   * Optimize value storage - choose best encoding based on type
   */
  optimizeValue(value: any): { encoded: any; type: EncodedType } {
    if (value === null || value === undefined) {
      return { encoded: value, type: EncodedType.STRING };
    }

    // Date optimization
    if (value instanceof Date) {
      if (this.config.enableDateEncoding) {
        return {
          encoded: this.encodeDateAsBlockHeight(value, 0),
          type: EncodedType.DATE_AS_BLOCK_HEIGHT,
        };
      }
      return {
        encoded: value.getTime(),
        type: EncodedType.TIMESTAMP,
      };
    }

    // BigInt optimization
    if (typeof value === 'bigint') {
      return {
        encoded: value.toString(),
        type: EncodedType.BIG_INT,
      };
    }

    // Boolean optimization (compact representation)
    if (typeof value === 'boolean') {
      return {
        encoded: value ? 1 : 0,
        type: EncodedType.NUMBER,
      };
    }

    // Number optimization
    if (typeof value === 'number') {
      // Check if it's an integer
      if (Number.isInteger(value)) {
        return {
          encoded: value,
          type: EncodedType.NUMBER,
        };
      }
      return {
        encoded: value,
        type: EncodedType.NUMBER,
      };
    }

    // String (default)
    return {
      encoded: value,
      type: EncodedType.STRING,
    };
  }

  /**
   * Decode optimized value back to original
   */
  decodeValue(encoded: any, type: EncodedType): any {
    switch (type) {
      case EncodedType.DATE_AS_BLOCK_HEIGHT:
        // Can't decode without current block height - return as is
        return encoded;
      
      case EncodedType.TIMESTAMP:
        return new Date(encoded);
      
      case EncodedType.BIG_INT:
        return BigInt(encoded);
      
      case EncodedType.NUMBER:
        return encoded;
      
      case EncodedType.BOOLEAN:
        return encoded === 1;
      
      case EncodedType.STRING:
      default:
        return encoded;
    }
  }

  /**
   * Compress and serialize data in one operation
   */
  pack(data: any, options?: {
    compression?: CompressionAlgorithm;
    serialization?: SerializationType;
  }): Buffer {
    const serialized = this.serialize(data, options?.serialization);
    const compressed = this.compress(serialized, options?.compression);
    return compressed.data;
  }

  /**
   * Decompress and deserialize data in one operation
   */
  unpack(data: Buffer, options?: {
    compression: CompressionAlgorithm;
    serialization?: SerializationType;
  }): any {
    const decompressed = this.decompress(data, options?.compression);
    return this.deserialize(decompressed, options?.serialization);
  }

  /**
   * Calculate storage savings
   */
  calculateSavings(original: Buffer, optimized: Buffer): {
    bytesSaved: number;
    percentageSaved: number;
  } {
    const bytesSaved = original.length - optimized.length;
    const percentageSaved = (bytesSaved / original.length) * 100;
    
    return {
      bytesSaved,
      percentageSaved: Math.max(0, percentageSaved),
    };
  }

  // Private methods

  private gzipCompress(data: Buffer): Buffer {
    const zlib = require('zlib');
    return zlib.gzipSync(data);
  }

  private gzipDecompress(data: Buffer): Buffer {
    const zlib = require('zlib');
    return zlib.gunzipSync(data);
  }
}

// Utility functions for quick operations

/**
 * Quick compress string
 */
export function compressString(input: string, algorithm: CompressionAlgorithm = CompressionAlgorithm.GZIP): Buffer {
  const zlib = require('zlib');
  const buffer = Buffer.from(input);
  
  switch (algorithm) {
    case CompressionAlgorithm.GZIP:
      return zlib.gzipSync(buffer);
    case CompressionAlgorithm.ZSTD:
      // Fallback to gzip
      return zlib.gzipSync(buffer);
    default:
      return buffer;
  }
}

/**
 * Quick decompress string
 */
export function decompressString(input: Buffer, algorithm: CompressionAlgorithm = CompressionAlgorithm.GZIP): string {
  const zlib = require('zlib');
  
  switch (algorithm) {
    case CompressionAlgorithm.GZIP:
      return zlib.gunzipSync(input).toString();
    case CompressionAlgorithm.ZSTD:
      return zlib.gunzipSync(input).toString();
    default:
      return input.toString();
  }
}

/**
 * Encode date efficiently
 */
export function encodeDate(date: Date): number {
  return Math.floor(date.getTime() / 1000); // Unix timestamp in seconds
}

/**
 * Decode date efficiently
 */
export function decodeDate(encoded: number): Date {
  return new Date(encoded * 1000);
}