import { useLogin } from "../login";
import useWoT from "../wot";

export function WoTDebugger() {
  const login = useLogin();
  const wot = useWoT();
  
  if (!login) {
    return <div>Not logged in</div>;
  }
  
  const testUsers = [
    login.publicKey, // Should be distance 0
    // Add some test pubkeys if needed
  ];
  
  return (
    <div style={{ 
      position: 'fixed', 
      top: '10px', 
      right: '10px', 
      background: 'rgba(0,0,0,0.8)', 
      color: 'white', 
      padding: '10px',
      fontSize: '12px',
      zIndex: 9999
    }}>
      <h4>WoT Debug</h4>
      <div>Logged in: {login.publicKey.slice(0, 8)}...</div>
      <div>Social graph: {wot.instance ? 'Available' : 'Not available'}</div>
      {testUsers.map(pubkey => (
        <div key={pubkey}>
          {pubkey.slice(0, 8)}...: {wot.followDistance(pubkey)}
        </div>
      ))}
    </div>
  );
}