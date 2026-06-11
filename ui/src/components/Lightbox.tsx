export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div className="modal-backdrop lightbox" onClick={onClose}>
      <img src={src} alt="" onClick={onClose} />
    </div>
  )
}
