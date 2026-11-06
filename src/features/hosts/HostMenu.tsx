import {
  Copy,
  CopyPlus,
  FolderSync,
  Monitor,
  Pencil,
  SquareTerminal,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  ContextItem,
  ContextSeparator,
  DropdownItem,
  DropdownSeparator,
} from '@/components/ui/menu'
import { copyText } from '@/lib/clipboard'
import type { Host } from '@/lib/ipc'
import { hostToInput, useHosts } from '@/stores/hosts'
import { useUi } from '@/stores/ui'
import { address, connectHost, openHostAs, rdpClientName } from './lib'

interface Action {
  key: string
  label: string
  icon: React.ReactNode
  run: () => void
  danger?: boolean
  separatorBefore?: boolean
}

function useHostActions(host: Host): Action[] {
  const editHost = useUi((s) => s.editHost)
  const { save, remove, toggleFavorite } = useHosts.getState()
  return [
    ...(host.protocol === 'rdp'
      ? [
          {
            key: 'connect',
            label: `Open in ${rdpClientName}`,
            icon: <Monitor />,
            run: () => connectHost(host),
          },
        ]
      : [
          {
            key: 'terminal',
            label: 'Open terminal',
            icon: <SquareTerminal />,
            run: () => openHostAs(host, 'terminal'),
          },
          {
            key: 'files',
            label: 'Browse files (SFTP)',
            icon: <FolderSync />,
            run: () => openHostAs(host, 'files'),
          },
        ]),
    {
      key: 'edit',
      label: 'Edit host…',
      icon: <Pencil />,
      run: () => editHost(host),
      separatorBefore: true,
    },
    {
      key: 'fav',
      label: host.favorite ? 'Remove from favorites' : 'Add to favorites',
      icon: host.favorite ? <StarOff /> : <Star />,
      run: () => void toggleFavorite(host),
    },
    {
      key: 'dup',
      label: 'Duplicate',
      icon: <CopyPlus />,
      run: async () => {
        const { id: _id, ...rest } = hostToInput(host)
        const copy = await save({ ...rest, label: `${host.label} copy`, favorite: false })
        toast.success(`Added “${copy.label}”`)
      },
    },
    {
      key: 'copy',
      label: 'Copy address',
      icon: <Copy />,
      run: () =>
        void copyText(address(host)).then(() =>
          toast.success('Address copied', { duration: 1200 }),
        ),
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: <Trash2 />,
      danger: true,
      separatorBefore: true,
      run: () => {
        // Delete is immediate; offer a real undo by re-saving (secrets are gone, so say so).
        void remove(host.id).then(() =>
          toast(`Deleted “${host.label}”`, {
            description: 'Saved passwords for it were removed from the keychain.',
            action: {
              label: 'Undo',
              onClick: () => void save({ ...hostToInput(host), id: undefined }),
            },
          }),
        )
      },
    },
  ]
}

export function HostDropdownItems({ host }: { host: Host }) {
  return (
    <>
      {useHostActions(host).map((a) => (
        <span key={a.key} className="contents">
          {a.separatorBefore && <DropdownSeparator />}
          <DropdownItem onSelect={a.run} danger={a.danger}>
            {a.icon} {a.label}
          </DropdownItem>
        </span>
      ))}
    </>
  )
}

export function HostContextItems({ host }: { host: Host }) {
  return (
    <>
      {useHostActions(host).map((a) => (
        <span key={a.key} className="contents">
          {a.separatorBefore && <ContextSeparator />}
          <ContextItem onSelect={a.run} danger={a.danger}>
            {a.icon} {a.label}
          </ContextItem>
        </span>
      ))}
    </>
  )
}
