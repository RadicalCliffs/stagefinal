import { useEffect, useRef, useState } from 'react'

interface RouletteWheelProps {
  targetNumber: number
  duration?: number
}

const RouletteWheel = ({ targetNumber, duration = 2000 }: RouletteWheelProps) => {
  const [displayNumber, setDisplayNumber] = useState(0)
  const [isAnimating, setIsAnimating] = useState(false)
  const hasAnimated = useRef(false)
  const elementRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (hasAnimated.current) return
    
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !hasAnimated.current) {
            hasAnimated.current = true
            setIsAnimating(true)
            
            const steps = 60
            const increment = targetNumber / steps
            let current = 0
            let step = 0
            
            const interval = setInterval(() => {
              step++
              current = Math.min(current + increment, targetNumber)
              setDisplayNumber(Math.floor(current))
              
              if (step >= steps) {
                clearInterval(interval)
                setDisplayNumber(targetNumber)
                setIsAnimating(false)
              }
            }, duration / steps)
          }
        })
      },
      { threshold: 0.1 }
    )

    if (elementRef.current) {
      observer.observe(elementRef.current)
    }

    // Capture the current element reference for cleanup
    const currentElement = elementRef.current;

    return () => {
      if (currentElement) {
        observer.unobserve(currentElement)
      }
    }
  }, [targetNumber, duration])

  return (
    <div ref={elementRef} className="inline-flex items-center justify-center">
      <div className={`
        sequel-95 text-3xl sm:text-4xl font-bold
        ${isAnimating ? 'text-[#DDE404] animate-pulse' : 'text-white'}
        transition-colors duration-300
      `}>
        {displayNumber.toLocaleString()}
      </div>
    </div>
  )
}

export default RouletteWheel
