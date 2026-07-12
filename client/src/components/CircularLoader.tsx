import React from 'react';

const CircularLoader = () => {
  return (
    <div className="flex items-center justify-center" role="status" aria-label="Loading">
      <div className="relative h-12 w-12">
        <div className="absolute inset-0 animate-spin rounded-full border-4 border-foreground/15 border-t-foreground" />
      </div>
    </div>
  );
};

export default CircularLoader;
