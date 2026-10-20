import { describe, it, expect } from 'vitest';
import { rankUrls } from '../src/security';

const v4 = (address: string) => [{ address, family: 'IPv4', internal: false }];
describe('pairing address ranking', () => {
  it('puts Wi-Fi LAN before Radmin/OpenVPN and drops link-local + loopback', () => {
    const r = rankUrls({
      'Radmin VPN': v4('26.81.214.207'), 'Ethernet 3': v4('169.254.10.2'), 'Wi-Fi': v4('192.168.100.13'),
      'OpenVPN Data Channel Offload': v4('10.8.0.6'), 'vEthernet (WSL)': v4('172.20.16.1'), 'Loopback Pseudo-Interface 1': [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    }, 5317);
    expect(r.map((u) => u.url)).toEqual(['http://192.168.100.13:5317', 'http://26.81.214.207:5317', 'http://10.8.0.6:5317', 'http://172.20.16.1:5317']);
    expect(r[0].kind).toBe('lan'); expect(r.slice(1).every((u) => u.kind === 'virtual')).toBe(true);
  });
  it('Tailscale first', () => {
    const r = rankUrls({ 'Wi-Fi': v4('192.168.1.5'), Tailscale: v4('100.101.1.2') }, 5317);
    expect(r[0]).toMatchObject({ url: 'http://100.101.1.2:5317', kind: 'tailscale' });
  });
  it('still offers virtual adapters when nothing else exists', () => {
    expect(rankUrls({ 'Radmin VPN': v4('26.1.2.3') }, 5317)).toHaveLength(1);
  });
});
