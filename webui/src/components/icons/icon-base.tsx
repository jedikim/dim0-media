import type { Icon as PhosphorIcon } from "@phosphor-icons/react"
import { createElement, type ComponentType } from "react"
import type { AppIconComponent, AppIconProps } from "./types"


/**
 * Wraps a Phosphor component with the app's shared icon prop contract.
 */
export const createPhosphorIcon = (icon: PhosphorIcon): AppIconComponent => {
  const PhosphorWrappedIcon = ({
    size,
    strokeWidth = 2,
    weight,
    ...props
  }: AppIconProps) => (
    createElement(icon, {
      size,
      weight: weight ?? (strokeWidth >= 2.5 ? "bold" : strokeWidth <= 1.5 ? "light" : "regular"),
      ...props,
    })
  )

  return PhosphorWrappedIcon
}


/**
 * Wraps third-party React icon components behind the shared app icon props.
 */
export const createReactIcon = (
  icon: ComponentType<{ size?: number | string; color?: string; className?: string }>
): AppIconComponent => {
  const ReactWrappedIcon = ({ size, color, className }: AppIconProps) => {
    const Icon = icon

    return (
      <Icon
        size={size}
        color={color}
        className={className}
      />
    )
  }

  return ReactWrappedIcon
}
