import { createContext, useContext, useEffect, useState, useRef } from "react";

const backendUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";

const ChatContext = createContext();

export const ChatProvider = ({ children }) => {
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState();
  const [loading, setLoading] = useState(false);
  const [cameraZoomed, setCameraZoomed] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [transcription, setTranscription] = useState("");
  const [transcriptionStatus, setTranscriptionStatus] = useState("");
  
  // Use refs for recognition instance, flags, and final transcript
  const recognitionRef = useRef(null);
  const hasFinalResultRef = useRef(false);
  const noSpeechTimeoutRef = useRef(null);
  const finalTranscriptRef = useRef(""); // Store final transcript to avoid state delays

  const chat = async (message) => {
    console.log("Chat called with message:", message);
    setLoading(true);
    try {
      const response = await fetch(`${backendUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      
      if (!response.ok) throw new Error(`Network response: ${response.status}`);
      
      const data = await response.json();
      setMessages((prev) => [...prev, ...data.messages]);
    } catch (error) {
      console.error("Chat error:", error);
      setTranscriptionStatus("Failed to send message");
    } finally {
      setLoading(false);
    }
  };

  const startRecording = () => {
    console.log("startRecording called");
    
    // Clear existing recognition
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }

    setIsRecording(true);
    setTranscription("");
    setTranscriptionStatus("Listening...");
    hasFinalResultRef.current = false;
    finalTranscriptRef.current = "";

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setTranscriptionStatus("Speech API not supported");
      setIsRecording(false);
      return;
    }

    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.lang = "en-US";
    recognitionRef.current.interimResults = true;
    recognitionRef.current.continuous = true;

    recognitionRef.current.onstart = () => {
      console.log("SpeechRecognition started");
    };

    recognitionRef.current.onresult = (event) => {
      const results = Array.from(event.results);
      const interimTranscript = results
        .filter(result => !result.isFinal)
        .map(result => result[0].transcript)
        .join("");
      const finalTranscript = results
        .filter(result => result.isFinal)
        .map(result => result[0].transcript)
        .join("");

      // Update transcription for display (interim + final)
      const currentTranscript = finalTranscript + interimTranscript;
      setTranscription(currentTranscript);
      console.log("Current transcription:", currentTranscript);

      // Store final transcript in ref
      if (finalTranscript) {
        finalTranscriptRef.current = finalTranscript;
        console.log("Final transcript stored:", finalTranscript);
      }

      // Clear no-speech timeout when speech is detected
      if (currentTranscript.trim() && noSpeechTimeoutRef.current) {
        clearTimeout(noSpeechTimeoutRef.current);
        noSpeechTimeoutRef.current = null;
      }

      // Stop recording on final result
      if (results.some(result => result.isFinal)) {
        hasFinalResultRef.current = true;
        stopRecording();
      }
    };

    recognitionRef.current.onend = () => {
      console.log("SpeechRecognition ended");
      
      // Only finish recording if not restarting
      if (!isRecording) {
        finishRecording();
      } else if (!hasFinalResultRef.current) {
        console.log("Restarting recognition");
        recognitionRef.current.start();
      } else {
        finishRecording();
      }
    };

    recognitionRef.current.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      setTranscriptionStatus(`Error: ${event.error}`);
      finishRecording();
    };

    console.log("Starting SpeechRecognition");
    try {
      recognitionRef.current.start();
    } catch (error) {
      console.error("Failed to start SpeechRecognition:", error);
      setTranscriptionStatus("Failed to start recognition");
      finishRecording();
    }

    // Set timeout for no speech detection
    noSpeechTimeoutRef.current = setTimeout(() => {
      if (isRecording && !transcription.trim()) {
        console.log("No speech detected, stopping recording");
        stopRecording();
      }
    }, 5000);
  };

  const stopRecording = () => {
    console.log("stopRecording called");
    
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null; // Clear recognition to prevent restarts
    }
    
    setIsRecording(false);
    setTranscriptionStatus("Processing...");
  };

  const finishRecording = () => {
    console.log("finishRecording called");
    console.log("Final transcript ref:", finalTranscriptRef.current);
    console.log("State transcription:", transcription);
    
    // Clear timeout
    if (noSpeechTimeoutRef.current) {
      clearTimeout(noSpeechTimeoutRef.current);
      noSpeechTimeoutRef.current = null;
    }
    
    setIsRecording(false);
    setTranscriptionStatus("");

    // Use finalTranscriptRef to avoid state delay
    const transcriptToSend = finalTranscriptRef.current || transcription.trim();
    if (transcriptToSend) {
      console.log("Sending transcript to chat:", transcriptToSend);
      chat(transcriptToSend);
    } else {
      console.log("No transcript to send");
      setTranscriptionStatus("No speech detected");
    }

    // Reset refs and state
    finalTranscriptRef.current = "";
    setTranscription("");
    recognitionRef.current = null;
  };

  const onMessagePlayed = () => {
    setMessages((prev) => prev.slice(1));
  };

  useEffect(() => {
    if (messages.length > 0) {
      setMessage(messages[0]);
    } else {
      setMessage(null);
    }
  }, [messages]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (noSpeechTimeoutRef.current) {
        clearTimeout(noSpeechTimeoutRef.current);
      }
    };
  }, []);

  return (
    <ChatContext.Provider
      value={{
        chat,
        message,
        onMessagePlayed,
        loading,
        cameraZoomed,
        setCameraZoomed,
        isRecording,
        startRecording,
        stopRecording,
        transcription,
        transcriptionStatus,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => useContext(ChatContext);