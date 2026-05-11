import { CheckmarkIcon, MonitorIcon, MoonIcon, SunIcon } from "@/components/icons"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTheme } from "@/components/theme-provider"
import { type Mode, type ThemeMeta } from "@/components/theme-constants"


type SwatchTrio = ThemeMeta["swatchLight"]


/** Three-dot color swatch row for previewing a theme. */
function Swatches({ colors }: { colors: SwatchTrio }) {
  return (
    <span className='inline-flex items-center gap-0.5'>
      {colors.map((c, i) => (
        <span
          key={i}
          className='inline-block h-2.5 w-2.5 rounded-full border border-border'
          style={{ backgroundColor: c }}
        />
      ))}
    </span>
  )
}


const MODES: { id: Mode; label: string; Icon: typeof SunIcon }[] = [
  { id: "light",  label: "Light",  Icon: SunIcon },
  { id: "dark",   label: "Dark",   Icon: MoonIcon },
  { id: "system", label: "System", Icon: MonitorIcon },
]


/**
 * Combined theme + mode picker. Trigger shows the active theme's swatch trio;
 * dropdown groups theme selection on top and mode selection below.
 */
export function ModeToggle(props: React.ComponentProps<typeof Button>) {
  const { themeId, mode, resolvedTheme, themes, setThemeId, setMode } = useTheme()
  const activeTheme = themes.find((t) => t.id === themeId) ?? themes[0]
  const activeSwatch = resolvedTheme === "dark" ? activeTheme.swatchDark : activeTheme.swatchLight

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className='border-none !size-8 !bg-transparent hover:!bg-accent/50 !shadow-none'
          {...props}
        >
          <Swatches colors={activeSwatch} />
          <span className="sr-only">Theme and mode</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className='min-w-[180px]'>
        <DropdownMenuLabel className='text-xs text-muted-foreground font-normal'>Theme</DropdownMenuLabel>
        {themes.map((t) => {
          const swatch = resolvedTheme === "dark" ? t.swatchDark : t.swatchLight
          const isActive = t.id === themeId
          return (
            <DropdownMenuItem key={t.id} onClick={() => setThemeId(t.id)} className='gap-2'>
              <Swatches colors={swatch} />
              <span className='flex-1'>{t.label}</span>
              {isActive ? <CheckmarkIcon className='h-3.5 w-3.5' /> : null}
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className='text-xs text-muted-foreground font-normal'>Mode</DropdownMenuLabel>
        {MODES.map(({ id, label, Icon }) => {
          const isActive = id === mode
          return (
            <DropdownMenuItem key={id} onClick={() => setMode(id)} className='gap-2'>
              <Icon className='h-4 w-4' />
              <span className='flex-1'>{label}</span>
              {isActive ? <CheckmarkIcon className='h-3.5 w-3.5' /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
