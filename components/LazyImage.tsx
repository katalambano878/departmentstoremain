'use client';

import { useEffect, useState } from 'react';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';

interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
  priority?: boolean;
  onLoad?: () => void;
  sizes?: string;
  /** Override the optimization width (default auto-picks based on sizes) */
  optimizeWidth?: number;
  quality?: number;
}

const SRCSET_WIDTHS = [480, 800];

function buildSrcSet(src: string, quality: number): string {
  return SRCSET_WIDTHS
    .map(w => {
      const url = getOptimizedImageUrl(src, { width: w, quality, format: 'webp' });
      return url !== src ? `${url} ${w}w` : null;
    })
    .filter(Boolean)
    .join(', ');
}

export default function LazyImage({
  src,
  alt,
  className = '',
  width,
  height,
  priority = false,
  onLoad,
  sizes = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw',
  optimizeWidth,
  quality = 70
}: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [useOrigin, setUseOrigin] = useState(false);
  const normalizedSrc = typeof src === 'string' ? src.trim() : '';

  const optimizedSrc = optimizeWidth
    ? getOptimizedImageUrl(normalizedSrc, { width: optimizeWidth, quality, format: 'webp' })
    : getOptimizedImageUrl(normalizedSrc, { width: 800, quality, format: 'webp' });

  const displaySrc = useOrigin ? normalizedSrc : optimizedSrc;
  const srcSet = useOrigin ? '' : buildSrcSet(normalizedSrc, quality);

  useEffect(() => {
    setIsLoaded(false);
    setHasError(false);
    setUseOrigin(false);
  }, [src]);

  const handleLoad = () => {
    setIsLoaded(true);
    onLoad?.();
  };

  const handleError = () => {
    if (!useOrigin && optimizedSrc !== normalizedSrc) {
      setUseOrigin(true);
      setIsLoaded(false);
      return;
    }
    setHasError(true);
    setIsLoaded(true);
    onLoad?.();
  };

  if (!normalizedSrc || hasError) {
    return (
      <div
        className={`relative overflow-hidden bg-gray-200 flex items-center justify-center w-full h-full ${className}`}
        style={width || height ? { width, height } : undefined}
      >
        <span className="text-gray-400 text-xs">No Image</span>
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden w-full h-full ${className}`}
      style={width || height ? { width, height } : undefined}
    >
      {!isLoaded && (
        <div className="absolute inset-0 bg-gray-200 animate-pulse z-10"></div>
      )}
      <img
        src={displaySrc}
        srcSet={srcSet || undefined}
        sizes={srcSet ? sizes : undefined}
        alt={alt}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={handleLoad}
        onError={handleError}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={priority ? 'high' : 'auto'}
      />
    </div>
  );
}
