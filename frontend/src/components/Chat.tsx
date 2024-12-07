import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiService } from '../services/api';

interface Message {
    id: string;
    text: string;
    sender: 'user' | 'bot';
    timestamp: Date;
}

interface ChatProps {
    messages: Message[];
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}

// Add this mock data before the Chat component
const mockMessages: Message[] = [
    {
        id: '0',
        text: "Talk freely and our ChatBot will help track your assets",
        sender: 'bot',
        timestamp: new Date()
    },
    {
        id: "1",
        text: "How can I track my shipment?",
        sender: "user",
        timestamp: new Date("2024-03-20T10:00:00")
    },
    {
        id: "2",
        text: "To track your shipment, you can use the following methods:\n\n1. **Online Tracking**: Visit our tracking portal\n2. **Mobile App**: Download our mobile app\n3. **SMS Updates**: Text your tracking number to 12345\n\nYou can also check the status using this format:\n```\nTracking Number: ABC123\nStatus: In Transit\n```",
        sender: "bot",
        timestamp: new Date("2024-03-20T10:00:05")
    },
    {
        id: "3",
        text: "What's the delivery time for express shipping?",
        sender: "user",
        timestamp: new Date("2024-03-20T10:01:00")
    },
    {
        id: "4",
        text: "Here are our express shipping times:\n\n| Service Level | Delivery Time | Cost |\n|--------------|---------------|-------|\n| Standard | 3-5 days | $9.99 |\n| Express | 1-2 days | $19.99 |\n| Same Day | 24 hours | $29.99 |",
        sender: "bot",
        timestamp: new Date("2024-03-20T10:01:05")
    }
];

const MarkdownMessage: React.FC<{ content: string }> = ({ content }) => (
    <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        className="text-[14px] leading-relaxed tracking-wide prose prose-invert max-w-none font-roboto-mono"
        components={{
            // Customize markdown components
            p: ({children}) => <p className="mb-2 last:mb-0">{children}</p>,
            code: ({children}) => (
                <code className="px-1 py-0.5 bg-black/30 rounded text-gray-200 font-mono text-sm">
                    {children}
                </code>
            ),
            pre: ({children}) => (
                <pre className="bg-black/30 p-3 rounded-lg my-2 overflow-x-auto">
                    {children}
                </pre>
            ),
            ul: ({children}) => <ul className="list-disc ml-4 mb-2">{children}</ul>,
            ol: ({children}) => <ol className="list-decimal ml-4 mb-2">{children}</ol>,
            li: ({children}) => <li className="mb-1">{children}</li>,
            table: ({children}) => (
                <div className="overflow-x-auto my-2">
                    <table className="min-w-full divide-y divide-gray-700">
                        {children}
                    </table>
                </div>
            ),
            th: ({children}) => (
                <th className="px-3 py-2 bg-black/20 text-left text-sm font-semibold">
                    {children}
                </th>
            ),
            td: ({children}) => (
                <td className="px-3 py-2 border-t border-gray-700 text-sm">
                    {children}
                </td>
            ),
        }}
    >
        {content}
    </ReactMarkdown>
);

const Chat: React.FC<ChatProps> = ({ messages, setMessages }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [width, setWidth] = useState(400);
    const [isResizing, setIsResizing] = useState(false);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        setMessages(mockMessages);
    }, []);

    // Add resize handler
    const handleMouseDown = (e: React.MouseEvent) => {
        setIsResizing(true);
        document.body.classList.add('resizing');
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (isResizing) {
            e.preventDefault();
            e.stopPropagation();
            // Calculate from the right edge of the screen
            const newWidth = window.innerWidth - e.clientX;
            if (newWidth >= 300 && newWidth <= 800) {
                setWidth(newWidth);
                // Update button position
                const button = document.querySelector('.chat-toggle-button');
                if (button) {
                    (button as HTMLElement).style.right = `${newWidth + 24}px`;
                }
            }
        }
    };

    const handleMouseUp = () => {
        setIsResizing(false);
        document.body.classList.remove('resizing');
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    };

    useEffect(() => {
        const handleTouchMove = (e: TouchEvent) => {
            if (isResizing && e.touches.length > 0) {
                e.preventDefault();
                const touch = e.touches[0];
                const newWidth = window.innerWidth - touch.clientX;
                if (newWidth >= 300 && newWidth <= 800) {
                    setWidth(newWidth);
                    const button = document.querySelector('.chat-toggle-button');
                    if (button) {
                        (button as HTMLElement).style.right = `${newWidth + 24}px`;
                    }
                }
            }
        };

        if (isResizing) {
            document.addEventListener('touchmove', handleTouchMove, { passive: false });
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            document.addEventListener('touchend', handleMouseUp);
        }

        return () => {
            document.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('touchend', handleMouseUp);
        };
    }, [isResizing]);

    const handleSend = async () => {
        if (!input.trim()) return;

        // Add user message
        const userMessage: Message = {
            id: Date.now().toString(),
            text: input,
            sender: 'user',
            timestamp: new Date()
        };
        setMessages(prev => [...prev, userMessage]);
        const userInput = input;
        setInput('');

        // Get bot response
        setLoading(true);
        try {
            const response = await apiService.sendChatMessage(userInput);
            console.log('Bot response:', response); // Debug log
            
            // Create bot message using the direct response string
            const botMessage: Message = {
                id: (Date.now() + 1).toString(),
                text: response, // Use the response directly since we handled parsing in apiService
                sender: 'bot',
                timestamp: new Date()
            };
            setMessages(prev => [...prev, botMessage]);
        } catch (error) {
            console.error('Chat error:', error);
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                text: error instanceof Error ? error.message : 'Sorry, I encountered an error. Please try again.',
                sender: 'bot',
                timestamp: new Date()
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`
                    fixed z-50 
                    bottom-6
                    bg-gradient-to-r from-[#1E1E1E] to-[#1e1e20]
                    px-4 py-3
                    text-gray-400 hover:text-white
                    transition-all duration-300
                    flex items-center gap-2
                    border border-gray-800/50
                    rounded-full
                    shadow-lg
                    text-xs uppercase tracking-wider
                    chat-toggle-button
                `}
                style={{ right: isOpen ? `${width + 24}px` : '24px' }}
            >
                {!isOpen && <span>Ask a question</span>}
                <span className="text-lg leading-none">{isOpen ? '×' : '💬'}</span>
            </button>

            <div 
                className={`
                    fixed right-0 top-0 h-full
                    bg-gradient-to-br from-[#1E1E1E]/60 via-[#858689]/60 to-[#e9e6e6]/60
                    transform ${isOpen ? 'translate-x-0' : 'translate-x-full'}
                    transition-transform duration-300 ease-in-out
                    z-40
                    flex flex-col
                    border-l border-gray-800/50
                    shadow-xl
                    ${isResizing ? 'transition-none' : 'transition-all duration-300'}
                `}
                style={{ width: `${width}px` }}
            >
                <div
                    className={`
                        absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize
                        ${isResizing ? 'bg-gray-600/30' : 'bg-transparent'}
                        transition-colors
                        group
                        z-50
                    `}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleMouseDown(e);
                    }}
                    onTouchStart={(e) => {
                        e.preventDefault();
                        handleMouseDown(e as any);
                    }}
                >
                    <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gray-600/30" />
                </div>
                <div className="h-14 px-6 flex items-center justify-between bg-[#282828] backdrop-blur-sm">
                    <div className="flex items-center gap-3">
                        <span className="text-2xl">🚚</span>
                        <h2 className="text-gray-400 text-xs uppercase tracking-wider">
                            Tracking Assistant
                        </h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-gray-400 text-xs uppercase tracking-wider">Active</span>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto py-6">
                    <div className="space-y-6 px-6">
                        {messages.map(message => (
                            <div
                                key={message.id}
                                className={`flex flex-col ${
                                    message.sender === 'user' ? 'items-end' : 'items-start'
                                }`}
                            >
                                <div
                                    className={`
                                        max-w-[85%] p-4 rounded-2xl
                                        ${message.sender === 'user'
                                            ? 'bg-gradient-to-r from-[#a832a0] to-[#8f47d6] text-white shadow-lg'
                                            : 'bg-gradient-to-r from-[#1c1c1c] to-[#3f3e3e] text-gray-200 shadow-lg'
                                        }
                                    `}
                                >
                                    {message.sender === 'user' ? (
                                        <p className="text-[14px] font-roboto-mono leading-relaxed tracking-wide">
                                            {message.text}
                                        </p>
                                    ) : (
                                        <MarkdownMessage content={message.text} />
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="p-4 bg-black/20 backdrop-blur-md border-t border-gray-800/50">
                    <div className="flex items-center gap-2 bg-[#282828] rounded-xl px-4 py-3 shadow-inner">
                        {loading && (
                            <div className="px-6 py-2">
                                <div className="flex items-center justify-center space-x-2 text-gray-400">
                                    <div className="w-2 h-2 rounded-full bg-gray-400 animate-pulse"></div>
                                    <div className="w-2 h-2 rounded-full bg-gray-400 animate-pulse delay-100"></div>
                                    <div className="w-2 h-2 rounded-full bg-gray-400 animate-pulse delay-200"></div>
                                </div>
                            </div>
                        )}
                        <input
                            type="text"
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSend()}
                            placeholder="I'm looking for..."
                            className="flex-1 bg-transparent text-gray-200 text-sm placeholder-gray-500 focus:outline-none tracking-wide"
                            disabled={loading}
                        />
                        <button 
                            onClick={handleSend}
                            disabled={loading}
                            className="text-gray-400 hover:text-indigo-400 transition-colors"
                        >
                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
};

export default Chat; 