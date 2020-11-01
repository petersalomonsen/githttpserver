function toggleMenu() {
    const sidemenu = document.getElementById('sidemenu');
    const togglebutton = document.querySelector('.menutogglebutton');
    togglebutton.classList.toggle('menutogglebuttonchange');

    if (togglebutton.classList.contains('menutogglebuttonchange')) {
        sidemenu.style.width = '200px';
    } else {
        sidemenu.style.width = '0px';
    }
}
const mediaMatcher = window.matchMedia("(max-width: 600px)");
document.querySelectorAll('#sidemenu li').forEach(menuItem =>
    menuItem.addEventListener('click', () => {
        if (mediaMatcher.matches) {
            toggleMenu();
        }
    })
);
function toggleConsoleHeight() {
    const maingrid = document.querySelector('.maingrid');
    const maingridrows = getComputedStyle(maingrid).gridTemplateRows.split(' ');

    const sidemenu = document.getElementById('sidemenu');
    const consoletoggle = document.querySelector('#consoletoggle i');

    if (maingridrows[2] === '100px') {
        maingridrows[2] = sidemenu.clientHeight + 'px';
        consoletoggle.classList.remove('up');
        consoletoggle.classList.add('down');
    } else {
        maingridrows[2] = '100px';
        consoletoggle.classList.remove('down');
        consoletoggle.classList.add('up');
    }
    maingridrows[1] = 'auto';

    maingrid.style.gridTemplateRows = maingridrows.join(' ');
}