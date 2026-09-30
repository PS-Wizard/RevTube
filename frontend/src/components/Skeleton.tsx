import React from 'react';
import './Skeleton.css';

interface SkeletonProps {
  type?: 'text' | 'title' | 'avatar' | 'card' | 'table-row';
  width?: string | number;
  height?: string | number;
  className?: string;
  style?: React.CSSProperties;
}

export const Skeleton: React.FC<SkeletonProps> = ({ 
  type = 'text', 
  width, 
  height, 
  className = '',
  style = {}
}) => {
  const classes = `skeleton skeleton-${type} ${className}`;
  
  const customStyle: React.CSSProperties = {
    ...style,
    width: width ?? style.width,
    height: height ?? style.height,
  };

  return <div className={classes} style={customStyle} />;
};
