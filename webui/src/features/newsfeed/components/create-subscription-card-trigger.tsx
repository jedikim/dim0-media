import * as React from 'react'
import { AddIcon } from '@/components/icons'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type Props = React.ComponentPropsWithoutRef<'button'>

export const CreateSubscriptionCardTrigger = React.forwardRef<HTMLButtonElement, Props>(
  ({ className, children, ...props }, ref) => {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type='button'
              ref={ref}
              {...props}
            className={cn(
                'w-64 h-20 rounded-xl border-2 border-dashed border-border',
                'hover:border-secondary-foreground hover:ring-2 hover:ring-secondary-foreground/20 transition-colors cursor-pointer',
                'flex items-center justify-center bg-background',
                className
              )}
            >
              <AddIcon className='w-6 h-6 text-secondary-foreground' strokeWidth={2} />
              {children}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            Create New Topic
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
)

CreateSubscriptionCardTrigger.displayName = 'CreateSubscriptionCardTrigger'
