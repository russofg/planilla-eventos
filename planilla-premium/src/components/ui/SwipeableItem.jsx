import { motion, useAnimation, useMotionValue } from "framer-motion"
import { Trash2, Edit } from "lucide-react"

export function SwipeableItem({ children, onEdit, onDelete }) {
  const controls = useAnimation()
  const x = useMotionValue(0)

  const handleDragEnd = (event, info) => {
    // If dragged past a threshold, snap to open (-110px), else snap back to 0
    if (info.offset.x < -50) {
      controls.start({ x: -110 })
    } else {
      controls.start({ x: 0 })
    }
  }

  // Reset function to close manually via parent or on click inside
  const handleAction = (actionFn) => {
    controls.start({ x: 0 })
    if (actionFn) actionFn()
  }

  // Separate Desktop logic from Mobile Drag
  const handleMouseEnter = () => {
    if (window.matchMedia("(hover: hover)").matches) {
       controls.start({ x: -110 })
    }
  }

  const handleMouseLeave = () => {
     if (window.matchMedia("(hover: hover)").matches) {
       controls.start({ x: 0 })
     }
  }

  return (
    <div 
      className="relative overflow-hidden rounded-xl group/swipe"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      
      {/* Background Action Buttons */}
      <div className="absolute inset-y-0 right-0 flex items-center justify-end px-3 gap-2 w-[110px] bg-red-500/10">
        <button 
          onClick={(e) => { e.stopPropagation(); handleAction(onEdit); }}
          className="p-2.5 bg-blue-500/20 hover:bg-blue-500/40 text-blue-400 rounded-lg transition-colors flex items-center justify-center cursor-pointer"
          title="Editar"
        >
          <Edit className="w-4 h-4 pointer-events-none" />
        </button>
        <button 
          onClick={(e) => { e.stopPropagation(); handleAction(onDelete); }}
          className="p-2.5 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded-lg transition-colors flex items-center justify-center cursor-pointer"
          title="Eliminar"
        >
          <Trash2 className="w-4 h-4 pointer-events-none" />
        </button>
      </div>

      {/* Foreground Swipeable Content */}
      <motion.div
        drag="x"
        dragConstraints={{ left: -110, right: 0 }}
        dragElastic={0.1}
        onDragEnd={handleDragEnd}
        animate={controls}
        style={{ x }}
        className="relative z-10 w-full rounded-xl bg-[#111] transition-transform duration-300 ease-out"
      >
        <div className="lg:hidden absolute flex w-full h-full inset-0 z-20" style={{ pointerEvents: 'none' }}>
           {/* Mobile drag surface helper */}
        </div>
        <div className="flex w-full h-full items-center">
             <div className="w-full bg-[#111] h-full sm:peer">
               {children}
             </div>
        </div>
      </motion.div>
    </div>
  )
}
