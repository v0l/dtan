import React from 'react';

interface RichTextContentProps {
  text: string;
}

// Helper function to check if a string is an image URL
const isImageUrl = (string: string): boolean => /\.(jpeg|jpg|gif|png)$/.test(string);

// Helper function to check if a string is a web URL
const isWebUrl = (string: string): boolean => {
  const urlPattern = new RegExp('^(https?:\\/\\/)' + // protocol
    '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|' + // domain name
    '((\\d{1,3}\\.){3}\\d{1,3}))' + // OR IP (v4) address
    '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
    '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
    '(\\#[-a-z\\d_]*)?$', 'i'); // fragment locator
  return !!urlPattern.test(string);
};

// Function to split the text into segments
const getSegments = (text: string): { type: 'text' | 'image' | 'link', content: string }[] => {
  const words = text.match(/(\S+|\s+)/g) || [];
  const segments: { type: 'text' | 'image' | 'link', content: string }[] = [];
  let currentTextSegment = '';

  words.forEach(word => {
    const trimmedWord = word.trim();
    if (isImageUrl(trimmedWord)) {
      if (currentTextSegment) {
        segments.push({ type: 'text', content: currentTextSegment });
        currentTextSegment = '';
      }
      segments.push({ type: 'image', content: trimmedWord });
    } else if (isWebUrl(trimmedWord)) {
      if (currentTextSegment) {
        segments.push({ type: 'text', content: currentTextSegment });
        currentTextSegment = '';
      }
      segments.push({ type: 'link', content: trimmedWord });
    } else {
      currentTextSegment += word;
    }
  });

  if (currentTextSegment) {
    segments.push({ type: 'text', content: currentTextSegment });
  }

  return segments;
};

const RichTextContent: React.FC<RichTextContentProps> = ({ text }) => {
  const segments = getSegments(text);

  return (
    <div>
      {segments.map((segment, index) => {
        switch(segment.type) {
          case 'image':
            return <img key={index} src={segment.content} style={{maxHeight:'50vh'}} />;
          case 'link':
            return <a key={index} href={segment.content} className="text-indigo-300" target="_blank" rel="noopener noreferrer">{segment.content}</a>;
          default:
            return <span key={index}>{segment.content}</span>;
        }
      })}
    </div>
  );
};

export default RichTextContent;

