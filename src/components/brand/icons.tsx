import {
  Box,
  Bug,
  Cloud,
  Container,
  Cpu,
  Database,
  FlaskConical,
  FolderSync,
  Gamepad2,
  GitBranch,
  Globe,
  HardDrive,
  House,
  Laptop,
  Layers,
  Lock,
  type LucideIcon,
  Mail,
  Monitor,
  Network,
  Radio,
  Rocket,
  Router,
  Satellite,
  Server,
  Shield,
  SquareTerminal,
  Webhook,
  Zap,
} from 'lucide-react'
import type { Protocol } from '@/lib/ipc'

/**
 * How each protocol looks everywhere a host or tab appears. Colors are fixed hues (like
 * HOST_COLORS) so SSH, SFTP and RDP stay distinct on both themes.
 */
export const PROTOCOLS: Record<
  Protocol,
  { label: string; long: string; Icon: LucideIcon; color: string }
> = {
  ssh: { label: 'SSH', long: 'SSH terminal', Icon: SquareTerminal, color: '#F9B21A' },
  sftp: { label: 'SFTP', long: 'SFTP files', Icon: FolderSync, color: '#5FC77A' },
  rdp: { label: 'RDP', long: 'Remote Desktop', Icon: Monitor, color: '#5BB3F0' },
}

/** Icons a host can show instead of its initials. Keys are stored in `Host.icon`. */
export const HOST_ICONS: Record<string, { label: string; Icon: LucideIcon }> = {
  server: { label: 'Server', Icon: Server },
  database: { label: 'Database', Icon: Database },
  cloud: { label: 'Cloud', Icon: Cloud },
  container: { label: 'Container', Icon: Container },
  cpu: { label: 'Compute', Icon: Cpu },
  globe: { label: 'Web', Icon: Globe },
  shield: { label: 'Security', Icon: Shield },
  router: { label: 'Network gear', Icon: Router },
  network: { label: 'Network', Icon: Network },
  'hard-drive': { label: 'Storage', Icon: HardDrive },
  laptop: { label: 'Laptop', Icon: Laptop },
  monitor: { label: 'Desktop', Icon: Monitor },
  terminal: { label: 'Terminal', Icon: SquareTerminal },
  box: { label: 'Box', Icon: Box },
  layers: { label: 'Cluster', Icon: Layers },
  lab: { label: 'Lab', Icon: FlaskConical },
  rocket: { label: 'Deploy', Icon: Rocket },
  bug: { label: 'Debug', Icon: Bug },
  git: { label: 'Git', Icon: GitBranch },
  mail: { label: 'Mail', Icon: Mail },
  lock: { label: 'Vault', Icon: Lock },
  webhook: { label: 'API', Icon: Webhook },
  radio: { label: 'IoT', Icon: Radio },
  satellite: { label: 'Edge', Icon: Satellite },
  zap: { label: 'Fast', Icon: Zap },
  home: { label: 'Home', Icon: House },
  game: { label: 'Game server', Icon: Gamepad2 },
}

export const HOST_ICON_KEYS = Object.keys(HOST_ICONS)
