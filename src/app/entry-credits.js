export function showEntryCredits({ ui, onEnter }) {
  const dialog = ui.root.ownerDocument.createElement('dialog')
  dialog.className = 'credits-dialog'
  dialog.setAttribute('aria-labelledby', 'entry-credits-title')
  dialog.setAttribute('aria-describedby', 'entry-credits-message')
  dialog.innerHTML = `
    <header><h2 id="entry-credits-title">鸣谢</h2></header>
    <div class="credits-body">
      <p id="entry-credits-message">感谢以下 UP 主提供优质的枪械整合包。</p>
      <a class="credits-pack" href="https://www.curseforge.com/minecraft/customization/tacz-valorant-gun-pack-for-tacz" target="_blank" rel="noopener noreferrer">
        <span>无畏契约原皮枪包</span><small>CurseForge <span aria-hidden="true">↗</span></small>
      </a>
      <section aria-labelledby="entry-credits-creators">
        <h3 id="entry-credits-creators">Bilibili UP 主</h3>
        <ul class="credits-creators" role="list">
          <li><a href="https://space.bilibili.com/3546554459753351" target="_blank" rel="noopener noreferrer">何以解忧1294 <span aria-hidden="true">↗</span></a></li>
          <li><a href="https://space.bilibili.com/526060723" target="_blank" rel="noopener noreferrer">-幻梦星璇- <span aria-hidden="true">↗</span></a></li>
          <li><a href="https://space.bilibili.com/488799058" target="_blank" rel="noopener noreferrer">阡雪星跃F <span aria-hidden="true">↗</span></a></li>
          <li><a href="https://space.bilibili.com/298015072" target="_blank" rel="noopener noreferrer">Alumite <span aria-hidden="true">↗</span></a></li>
        </ul>
      </section>
      <button type="button" data-enter-range autofocus>进入靶场</button>
    </div>`
  const modal = ui.registerModal('entry-credits', dialog, { recaptureOnClose: false })
  dialog.querySelector('[data-enter-range]').addEventListener('click', (event) => {
    modal.close()
    onEnter(event)
  })
  modal.open()
}
