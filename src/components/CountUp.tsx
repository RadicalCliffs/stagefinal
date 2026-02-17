import { useEffect, useRef, useState } from "react";

interface CountUpProps {
  end: number;
  duration?: number; // in ms
  prefix?: string;
  suffix?: string;
  classes?:string
}

const CountUp = ({ end, duration = 1500, prefix = "", suffix = "", classes="" }: CountUpProps) => {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement | null>(null);
  const started = useRef(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !started.current) {
          started.current = true;

          let startTime: number | null = null;

          const step = (timestamp: number) => {
            if (!startTime) startTime = timestamp;
            const progress = Math.min((timestamp - startTime) / duration, 1);
            setCount(Math.floor(progress * end));

            if (progress < 1) requestAnimationFrame(step);
          };

          requestAnimationFrame(step);
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [end, duration]);

  // Note: text-ellipsis requires whitespace-nowrap and a max-width constraint.
  // The max-width should be provided via the classes prop when overflow handling is needed.
  return (
    <span ref={ref} className={`inline-block overflow-hidden whitespace-nowrap text-ellipsis ${classes}`}>
      {prefix}{count.toLocaleString()}{suffix}
    </span>
  );
};

export default CountUp;
